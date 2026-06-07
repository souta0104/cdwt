import { homedir } from "node:os";
import { CdwtError } from "../errors.js";
import { buildSections, deriveBranchesWithWorktree } from "../core/sections.js";
import { discoverConfigFiles, readMergedConfig } from "../io/config-loader.js";
import type { ConsoleIO } from "../io/console.js";
import { isGhAvailable, listPullRequests } from "../io/gh.js";
import { listLocalBranches, setGitDebug } from "../io/git.js";
import { loadRepoContext } from "../io/repo-context.js";
import { selectInteractive, type SelectorOptions } from "../ui/selector.js";
import { runCommandMode, type CommandModeOutcome } from "../ui/command-mode.js";
import { sectionLabel } from "../ui/format.js";
import type { DisplayLine, PullRequest, RepoContext } from "../types.js";
import {
  EXIT_CANCELLED,
  createNewWorktreeAction,
  createPrWorktreeAction,
  createWorktreeForBranchAction,
  deleteWorktreeAction,
  goToPrWorktreeAction,
  printDestination,
  type ActionContext,
} from "./actions.js";
import {
  SLASH_COMMANDS,
  type CommandHost,
  type CommandResult,
  type SlashCommand,
} from "./slash-commands.js";

export interface SelectOptions {
  defaultBranchOnly: boolean;
  /** Start with the PR filter enabled and PR list pre-fetched. */
  prFilter?: boolean;
  /**
   * Jump directly to the worktree for this PR number, skipping the picker.
   * `cd`s into `<repo>-pr-<number>` if it exists, otherwise creates it.
   */
  prNumber?: number;
  /**
   * `true` → prompt for branch name, `string` → use as branch name.
   * Skips the interactive picker and creates a new worktree directly.
   */
  newBranch?: string | true;
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

  if (options.newBranch !== undefined) {
    const ctx: ActionContext = {
      repo,
      config,
      branchesWithWorktree: deriveBranchesWithWorktree(repo),
      console,
    };
    const branchArg = options.newBranch === true ? undefined : options.newBranch;
    return createNewWorktreeAction(ctx, branchArg);
  }

  if (options.prNumber !== undefined) {
    const ctx: ActionContext = {
      repo,
      config,
      branchesWithWorktree: deriveBranchesWithWorktree(repo),
      console,
    };
    return goToPrWorktreeAction(ctx, options.prNumber);
  }

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

    switch (outcome.kind) {
      case "cancelled":
        return EXIT_CANCELLED;
      case "command-mode": {
        const code = await enterCommandMode(state, ctx, options, outcome.initialInput);
        if (code !== undefined) return code;
        continue;
      }
      case "delete-target": {
        const code = await handleDeleteTarget(state, ctx, options, outcome.line);
        if (code !== undefined) return code;
        continue;
      }
      case "selected":
        return dispatchSelected(state, ctx, options, outcome.line);
    }
  }
}

async function dispatchSelected(
  _state: State,
  ctx: ActionContext,
  options: SelectOptions,
  selected: DisplayLine,
): Promise<number> {
  options.console.debug(
    `selected: kind=${selected.kind} branch="${selected.branch}" destination="${selected.destination}"`,
  );
  switch (selected.kind) {
    case "worktree":
      printDestination(options.console, selected.destination);
      return 0;
    case "branch":
      return createWorktreeForBranchAction(ctx, selected.branch, selected.destination);
    case "pr": {
      if (selected.prNumber === null) throw new CdwtError("missing PR number");
      if (ctx.branchesWithWorktree.has(selected.branch)) {
        printDestination(options.console, selected.destination);
        return 0;
      }
      return createPrWorktreeAction(ctx, selected.prNumber, selected.destination);
    }
  }
}

/**
 * Drive the slash-command UI. Returns an exit code to terminate `runSelect`,
 * or `undefined` to re-open the picker.
 */
async function enterCommandMode(
  state: State,
  ctx: ActionContext,
  options: SelectOptions,
  initialInput: string | undefined,
): Promise<number | undefined> {
  const cmdOptions = {
    console: options.console,
    registry: SLASH_COMMANDS,
    ...(options.selectorOptions?.useFzf !== undefined
      ? { useFzf: options.selectorOptions.useFzf }
      : {}),
    ...(options.selectorOptions?.fzfRunner
      ? { fzfRunner: options.selectorOptions.fzfRunner }
      : {}),
    ...(initialInput !== undefined ? { initialInput } : {}),
  };
  const picked: CommandModeOutcome = await runCommandMode(cmdOptions);
  if (picked.kind === "cancelled") return undefined;

  const host = makeCommandHost(state, ctx, options);
  const result: CommandResult = await picked.command.execute(picked.args, host);
  if (result.kind === "exit") return result.code;
  return undefined;
}

function makeCommandHost(
  state: State,
  ctx: ActionContext,
  options: SelectOptions,
): CommandHost {
  return {
    console: options.console,
    printMainDestination() {
      printDestination(options.console, state.repo.mainWorktree);
    },
    createNewWorktree(branch: string | undefined) {
      return createNewWorktreeAction(ctx, branch);
    },
    async loadPrs() {
      if (state.prsLoaded) return;
      state.prs = await loadPrs(options.cwd, options.console);
      state.prsLoaded = true;
      rebuildLines(state, options.home);
    },
    async refresh() {
      await refresh(state, options);
    },
  };
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
    options.console.errln(
      `cdwt: ctrl-d only deletes worktree entries (got [${sectionLabel(target.section)}])`,
    );
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

// Re-exported so existing callers that imported it from select.ts keep working.
export type { SlashCommand };

export function defaultHome(): string {
  return process.env["HOME"] ?? homedir();
}
