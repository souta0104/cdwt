import { homedir } from "node:os";
import { CdwtError } from "../errors.js";
import { buildSections, deriveBranchesWithWorktree } from "../core/sections.js";
import { discoverConfigFiles, readMergedConfig } from "../io/config-loader.js";
import type { ConsoleIO } from "../io/console.js";
import { isGhAvailable, listPullRequests } from "../io/gh.js";
import { listLocalBranches, setGitDebug } from "../io/git.js";
import { loadRepoContext } from "../io/repo-context.js";
import { selectInteractive, type SelectorOptions } from "../ui/selector.js";
import {
  EXIT_CANCELLED,
  createNewWorktreeAction,
  createPrWorktreeAction,
  createWorktreeForBranchAction,
  deleteWorktreeAction,
  printDestination,
  type ActionContext,
} from "./actions.js";

export interface SelectOptions {
  defaultBranchOnly: boolean;
  cwd: string;
  configOverride: string | undefined;
  home: string;
  console: ConsoleIO;
  /**
   * Options forwarded to `selectInteractive`. Useful in tests to force
   * the prompt (non-fzf) path via `{ useFzf: false }`.
   */
  selectorOptions?: Omit<SelectorOptions, "console">;
}

export async function runSelect(options: SelectOptions): Promise<number> {
  const { console } = options;
  // Wire the git debug hook so every git invocation logs timing to stderr.
  setGitDebug((msg) => console.debug(msg));
  console.debug(`runSelect start cwd=${options.cwd}`);

  const repo = await loadRepoContext(options.cwd);
  console.debug(
    `repo context: mainWorktree=${repo.mainWorktree} defaultBranchRef=${repo.defaultBranchRef ?? "null"} worktrees=${repo.worktrees.length}`,
  );

  if (options.defaultBranchOnly) {
    printDestination(console, repo.mainWorktree);
    return 0;
  }

  const configFiles = await discoverConfigFiles({
    cwd: repo.cwd,
    mainWorktree: repo.mainWorktree,
    home: options.home,
    override: options.configOverride,
    debug: (msg) => console.debug(msg),
  });

  const config = await readMergedConfig(configFiles);
  console.debug(
    `merged config: patterns=[${config.copyIgnored.patterns.join(",")}] paths=[${config.copyIgnored.paths.join(",")}]`,
  );

  const t0GhCheck = Date.now();
  const ghAvailable = await isGhAvailable();
  console.debug(`gh available=${ghAvailable} (check took ${Date.now() - t0GhCheck}ms)`);

  const t0Listing = Date.now();
  const [prs, localBranches] = await Promise.all([
    ghAvailable ? listPullRequests(repo.cwd) : Promise.resolve([]),
    listLocalBranches(repo.cwd),
  ]);
  console.debug(
    `listing: prs=${prs.length} localBranches=${localBranches.length} (took ${Date.now() - t0Listing}ms)`,
  );

  const lines = buildSections({
    repo,
    prs,
    localBranches,
    home: options.home,
  });
  console.debug(`sections built: totalLines=${lines.length}`);

  if (lines.length === 0) {
    throw new CdwtError("no worktree or branch candidates found");
  }

  // Main action loop. We re-enter only when a delete action succeeds, so the
  // user can chain multiple deletions without relaunching the CLI.
  let inDeleteLoop = false;

  while (true) {
    // Refresh repo state on re-entry so deleted worktrees are gone from the list.
    const currentRepo = inDeleteLoop ? await loadRepoContext(options.cwd) : repo;
    const currentLines = inDeleteLoop
      ? buildSections({
          repo: currentRepo,
          prs,
          localBranches,
          home: options.home,
        })
      : lines;

    if (inDeleteLoop) {
      console.debug(
        `delete loop re-entry: worktrees=${currentRepo.worktrees.length} lines=${currentLines.length}`,
      );
      // If no deletable worktrees remain (only main), exit cleanly.
      const deletable = currentLines.filter((l) => l.kind === "delete");
      if (deletable.length === 0) {
        console.debug(`no more deletable worktrees; exiting delete loop`);
        printDestination(console, currentRepo.mainWorktree);
        return 0;
      }
    }

    const selected = await selectInteractive(currentLines, { console, ...options.selectorOptions });
    if (!selected) {
      if (inDeleteLoop) {
        // User escaped from the picker after deleting some worktrees.
        printDestination(console, currentRepo.mainWorktree);
        return 0;
      }
      return EXIT_CANCELLED;
    }

    console.debug(
      `selected: kind=${selected.kind} branch="${selected.branch}" destination="${selected.destination}"`,
    );

    const currentBranchesWithWorktree = deriveBranchesWithWorktree(currentRepo);
    const ctx: ActionContext = {
      repo: currentRepo,
      config,
      branchesWithWorktree: currentBranchesWithWorktree,
      console,
    };

    switch (selected.kind) {
      case "worktree":
        printDestination(console, selected.destination);
        return 0;
      case "delete": {
        const outcome = await deleteWorktreeAction(ctx, selected.destination);
        if (outcome.kind === "cancelled") {
          // User cancelled — go back to main worktree.
          printDestination(console, currentRepo.mainWorktree);
          return 0;
        }
        // Deleted — loop back to show delete picker again.
        inDeleteLoop = true;
        continue;
      }
      case "branch":
        return createWorktreeForBranchAction(ctx, selected.branch, selected.destination);
      case "new":
        return createNewWorktreeAction(ctx);
      case "pr": {
        if (selected.prNumber === null) throw new CdwtError("missing PR number");
        if (currentBranchesWithWorktree.has(selected.branch)) {
          printDestination(console, selected.destination);
          return 0;
        }
        return createPrWorktreeAction(ctx, selected.prNumber, selected.destination);
      }
    }
  }
}

export function defaultHome(): string {
  return process.env["HOME"] ?? homedir();
}
