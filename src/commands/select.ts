import { homedir } from "node:os";
import { CdwtError } from "../errors.js";
import { buildSections, deriveBranchesWithWorktree } from "../core/sections.js";
import { discoverConfigFiles, readMergedConfig } from "../io/config-loader.js";
import type { ConsoleIO } from "../io/console.js";
import { isGhAvailable, listPullRequests } from "../io/gh.js";
import { listLocalBranches, setGitDebug } from "../io/git.js";
import { loadRepoContext } from "../io/repo-context.js";
import {
  selectInteractive,
  type SelectorOptions,
  type SlashCommand,
} from "../ui/selector.js";
import type { DisplayLine, PullRequest, RepoContext } from "../types.js";
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
  /** Start with the PR filter enabled and PR list pre-fetched. */
  prFilter?: boolean;
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

interface State {
  repo: RepoContext;
  prs: PullRequest[];
  prsLoaded: boolean;
  localBranches: string[];
  lines: DisplayLine[];
}

export async function runSelect(options: SelectOptions): Promise<number> {
  const { console } = options;
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

  const localBranches = await listLocalBranches(repo.cwd);
  console.debug(`localBranches=${localBranches.length}`);

  let prs: PullRequest[] = [];
  let prsLoaded = false;
  if (options.prFilter) {
    prs = await loadPrs(options.cwd, console);
    prsLoaded = true;
  }

  const state: State = {
    repo,
    prs,
    prsLoaded,
    localBranches,
    lines: buildSections({ repo, prs, localBranches, home: options.home }),
  };

  if (state.lines.length === 0) {
    throw new CdwtError("no worktree or branch candidates found");
  }

  let initialFilter: SelectorOptions["initialFilter"] = options.prFilter ? "pr" : undefined;

  while (true) {
    const ctx: ActionContext = {
      repo: state.repo,
      config,
      branchesWithWorktree: deriveBranchesWithWorktree(state.repo),
      console,
    };

    const outcome = await selectInteractive(state.lines, {
      console,
      ...(initialFilter ? { initialFilter } : {}),
      ...options.selectorOptions,
    });
    initialFilter = undefined;

    if (outcome.kind === "cancelled") {
      return EXIT_CANCELLED;
    }

    if (outcome.kind === "slash") {
      const code = await dispatchSlash(state, ctx, options, outcome.command);
      if (code === undefined) continue;
      return code;
    }

    if (outcome.kind === "delete-target") {
      const code = await handleDeleteTarget(state, ctx, options, outcome.line);
      if (code === undefined) continue;
      return code;
    }

    const selected = outcome.line;
    console.debug(
      `selected: kind=${selected.kind} branch="${selected.branch}" destination="${selected.destination}"`,
    );

    switch (selected.kind) {
      case "worktree":
        printDestination(console, selected.destination);
        return 0;
      case "branch":
        return createWorktreeForBranchAction(ctx, selected.branch, selected.destination);
      case "pr": {
        if (selected.prNumber === null) throw new CdwtError("missing PR number");
        if (ctx.branchesWithWorktree.has(selected.branch)) {
          printDestination(console, selected.destination);
          return 0;
        }
        return createPrWorktreeAction(ctx, selected.prNumber, selected.destination);
      }
    }
  }
}

/**
 * Run a slash command. Returns an exit code to terminate the session, or
 * `undefined` to keep looping (e.g. after a refresh or delete-mode entry).
 */
async function dispatchSlash(
  state: State,
  ctx: ActionContext,
  options: SelectOptions,
  command: SlashCommand,
): Promise<number | undefined> {
  const { console } = options;
  switch (command.kind) {
    case "main":
      printDestination(console, state.repo.mainWorktree);
      return 0;
    case "new":
      return createNewWorktreeAction(ctx, command.branch);
    case "pr": {
      if (!state.prsLoaded) {
        state.prs = await loadPrs(options.cwd, console);
        state.prsLoaded = true;
        rebuildLines(state, options.home);
      }
      return undefined;
    }
    case "refresh":
      await refresh(state, options);
      return undefined;
    case "help":
      console.errln(HELP_TEXT);
      return undefined;
  }
}

/**
 * Handle ctrl-d (or `d <num>` in prompt fallback) on a highlighted entry.
 * Only acts on `wt` rows; other sections are rejected with a message and the
 * picker re-opens. After a successful delete, refresh state and return to the
 * picker — except when no worktree is left, in which case jump to main.
 */
async function handleDeleteTarget(
  state: State,
  ctx: ActionContext,
  options: SelectOptions,
  target: DisplayLine,
): Promise<number | undefined> {
  if (target.section === "main") {
    options.console.errln("cdwt: refusing to delete the default branch worktree");
    return undefined;
  }
  if (target.section !== "wt") {
    options.console.errln(`cdwt: ctrl-d only deletes worktree entries (got [${target.section}])`);
    return undefined;
  }
  const result = await deleteWorktreeAction(ctx, target.destination);
  if (result.kind === "cancelled") return undefined;
  await refresh(state, options);
  if (state.lines.filter((l) => l.section === "wt").length === 0) {
    printDestination(options.console, state.repo.mainWorktree);
    return 0;
  }
  return undefined;
}

async function refresh(state: State, options: SelectOptions): Promise<void> {
  state.repo = await loadRepoContext(options.cwd);
  state.localBranches = await listLocalBranches(state.repo.cwd);
  if (state.prsLoaded) {
    state.prs = await loadPrs(options.cwd, options.console);
  }
  rebuildLines(state, options.home);
}

function rebuildLines(state: State, home: string): void {
  state.lines = buildSections({
    repo: state.repo,
    prs: state.prs,
    localBranches: state.localBranches,
    home,
  });
}

async function loadPrs(cwd: string, console: ConsoleIO): Promise<PullRequest[]> {
  const t0 = Date.now();
  const ghAvailable = await isGhAvailable();
  console.debug(`gh available=${ghAvailable}`);
  if (!ghAvailable) return [];
  const prs = await listPullRequests(cwd);
  console.debug(`listed ${prs.length} PRs in ${Date.now() - t0}ms`);
  return prs;
}

const HELP_TEXT = [
  "shortcuts: enter=go  esc=cancel  tab=cycle filter  ctrl-d=delete  ?=help",
  "slash: /new <branch>  /main  /pr  /refresh  /help",
].join("\n");

export function defaultHome(): string {
  return process.env["HOME"] ?? homedir();
}
