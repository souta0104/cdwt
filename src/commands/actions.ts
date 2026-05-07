import { stat } from "node:fs/promises";
import { CdwtError } from "../errors.js";
import { copyConfiguredIgnoredPaths } from "../io/copy-files.js";
import {
  addWorktreeDetached,
  addWorktreeForBranch,
  addWorktreeNewBranch,
  branchExists,
  checkRefFormat,
  removeWorktree,
  removeWorktreeForce,
  removeWorktreeForceRaw,
} from "../io/git.js";
import { checkoutPr } from "../io/gh.js";
import type { ConsoleIO } from "../io/console.js";
import type { CdwtConfig, RepoContext } from "../types.js";
import { makeBranchPath } from "../core/paths.js";

export const EXIT_CANCELLED = 130;
const MAX_BRANCH_PROMPT_RETRIES = 5;

export interface ActionContext {
  repo: RepoContext;
  config: CdwtConfig;
  branchesWithWorktree: ReadonlySet<string>;
  console: ConsoleIO;
}

export type DeleteOutcome = { kind: "deleted" } | { kind: "cancelled" };

/** Print the destination path so the shell wrapper can `cd` into it. */
export function printDestination(console: ConsoleIO, target: string): void {
  console.outln(target);
}

export async function deleteWorktreeAction(
  ctx: ActionContext,
  target: string,
): Promise<DeleteOutcome> {
  if (target === ctx.repo.mainWorktree) {
    throw new CdwtError("refusing to delete the default branch worktree");
  }
  if (!(await ctx.console.confirm(`Delete worktree at "${target}"? [y/N] `))) {
    ctx.console.debug(`delete cancelled by user for ${target}`);
    return { kind: "cancelled" };
  }

  ctx.console.debug(`attempting git worktree remove for ${target}`);
  const result = await removeWorktree(ctx.repo.mainWorktree, target);
  ctx.console.debug(
    `git worktree remove exit=${result.exitCode} stderr=${result.stderr.length}B`,
  );

  if (result.exitCode === 0) {
    ctx.console.debug(`delete succeeded (clean) for ${target}`);
    return { kind: "deleted" };
  }

  if (result.stderr) ctx.console.errln(result.stderr.trimEnd());
  ctx.console.debug(`worktree is dirty, prompting for force delete`);

  if (!(await ctx.console.confirm(`Worktree has uncommitted changes. Force delete? [y/N] `))) {
    ctx.console.debug(`force delete cancelled by user for ${target}`);
    return { kind: "cancelled" };
  }

  ctx.console.debug(`attempting force remove for ${target}`);
  const force = await removeWorktreeForceRaw(ctx.repo.mainWorktree, target);
  ctx.console.debug(`force remove exit=${force.exitCode} stderr=${force.stderr.length}B`);

  if (force.exitCode !== 0) {
    if (force.stderr) ctx.console.errln(force.stderr.trimEnd());
    throw new CdwtError(
      `git worktree remove --force failed for ${target} (exit ${force.exitCode})`,
    );
  }

  ctx.console.debug(`force delete succeeded for ${target}`);
  return { kind: "deleted" };
}

export async function createWorktreeForBranchAction(
  ctx: ActionContext,
  branch: string,
  target: string,
): Promise<number> {
  await assertDestinationFree(target);
  await addWorktreeForBranch(ctx.repo.cwd, target, branch);
  await copyConfiguredIgnoredPaths({
    source: ctx.repo.mainWorktree,
    destination: target,
    config: ctx.config,
    console: ctx.console,
  });
  printDestination(ctx.console, target);
  return 0;
}

export async function createNewWorktreeAction(
  ctx: ActionContext,
  branchArg?: string,
): Promise<number> {
  const ref = ctx.repo.defaultBranchRef;
  if (!ref) throw new CdwtError("failed to detect the default branch");

  const branch =
    branchArg !== undefined && branchArg !== ""
      ? await validateNewBranch(ctx, branchArg)
      : await readNewBranchName(ctx);
  if (branch === null) return EXIT_CANCELLED;
  const target = makeBranchPath(branch, ctx.repo.mainWorktree, ctx.repo.repoName);
  await assertDestinationFree(target);
  await addWorktreeNewBranch(ctx.repo.cwd, target, branch, ref);
  await copyConfiguredIgnoredPaths({
    source: ctx.repo.mainWorktree,
    destination: target,
    config: ctx.config,
    console: ctx.console,
  });
  printDestination(ctx.console, target);
  return 0;
}

export async function createPrWorktreeAction(
  ctx: ActionContext,
  prNumber: number,
  target: string,
): Promise<number> {
  await assertDestinationFree(target);
  await addWorktreeDetached(ctx.repo.cwd, target);
  const ok = await checkoutPr(target, prNumber);
  if (!ok) {
    await removeWorktreeForce(ctx.repo.cwd, target, ctx.console);
    throw new CdwtError(`failed to checkout PR #${prNumber}`);
  }
  await copyConfiguredIgnoredPaths({
    source: ctx.repo.mainWorktree,
    destination: target,
    config: ctx.config,
    console: ctx.console,
  });
  printDestination(ctx.console, target);
  return 0;
}

async function validateNewBranch(ctx: ActionContext, raw: string): Promise<string | null> {
  const branch = raw.trim();
  if (branch === "") return null;
  if (!(await checkRefFormat(ctx.repo.cwd, branch))) {
    ctx.console.errln(`cdwt: invalid branch name: ${branch}`);
    return null;
  }
  if (await branchExists(ctx.repo.cwd, branch)) {
    ctx.console.errln(`cdwt: branch already exists: ${branch}`);
    return null;
  }
  if (ctx.branchesWithWorktree.has(branch)) {
    ctx.console.errln(`cdwt: branch already has a worktree: ${branch}`);
    return null;
  }
  return branch;
}

async function readNewBranchName(ctx: ActionContext): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_BRANCH_PROMPT_RETRIES; attempt++) {
    const raw = await ctx.console.ask("New branch name: ");
    if (raw === null) return null;
    const branch = raw.trim();
    if (branch === "") return null;
    const validated = await validateNewBranch(ctx, branch);
    if (validated !== null) return validated;
  }
  ctx.console.errln(`cdwt: too many invalid branch name attempts; aborting`);
  return null;
}

async function assertDestinationFree(target: string): Promise<void> {
  try {
    await stat(target);
  } catch {
    return;
  }
  throw new CdwtError(`destination already exists: ${target}`);
}
