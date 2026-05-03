import { homedir } from "node:os";
import { CdwtError } from "../errors.js";
import { buildSections, deriveBranchesWithWorktree } from "../core/sections.js";
import { discoverConfigFiles, readMergedConfig } from "../io/config-loader.js";
import type { ConsoleIO } from "../io/console.js";
import { isGhAvailable, listPullRequests } from "../io/gh.js";
import { listLocalBranches } from "../io/git.js";
import { loadRepoContext } from "../io/repo-context.js";
import { selectInteractive } from "../ui/selector.js";
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
}

export async function runSelect(options: SelectOptions): Promise<number> {
  const { console } = options;
  const repo = await loadRepoContext(options.cwd);

  if (options.defaultBranchOnly) {
    printDestination(console, repo.mainWorktree);
    return 0;
  }

  const configFiles = await discoverConfigFiles({
    cwd: repo.cwd,
    mainWorktree: repo.mainWorktree,
    home: options.home,
    override: options.configOverride,
  });
  const config = await readMergedConfig(configFiles);

  const ghAvailable = await isGhAvailable();
  const [prs, localBranches] = await Promise.all([
    ghAvailable ? listPullRequests(repo.cwd) : Promise.resolve([]),
    listLocalBranches(repo.cwd),
  ]);

  const lines = buildSections({
    repo,
    prs,
    localBranches,
    home: options.home,
  });

  if (lines.length === 0) {
    throw new CdwtError("no worktree or branch candidates found");
  }

  const selected = await selectInteractive(lines, { console });
  if (!selected) return EXIT_CANCELLED;

  const branchesWithWorktree = deriveBranchesWithWorktree(repo);
  const ctx: ActionContext = { repo, config, branchesWithWorktree, console };

  switch (selected.kind) {
    case "worktree":
      printDestination(console, selected.destination);
      return 0;
    case "delete":
      return deleteWorktreeAction(ctx, selected.destination);
    case "branch":
      return createWorktreeForBranchAction(ctx, selected.branch, selected.destination);
    case "new":
      return createNewWorktreeAction(ctx);
    case "pr": {
      if (selected.prNumber === null) throw new CdwtError("missing PR number");
      if (branchesWithWorktree.has(selected.branch)) {
        printDestination(console, selected.destination);
        return 0;
      }
      return createPrWorktreeAction(ctx, selected.prNumber, selected.destination);
    }
  }
}

export function defaultHome(): string {
  return process.env["HOME"] ?? homedir();
}
