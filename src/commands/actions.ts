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

/** Print the destination path so the shell wrapper can `cd` into it. */
export function printDestination(console: ConsoleIO, target: string): void {
  console.outln(target);
}

export async function deleteWorktreeAction(ctx: ActionContext, target: string): Promise<number> {
  if (target === ctx.repo.mainWorktree) {
    throw new CdwtError("refusing to delete the default branch worktree");
  }
  if (!(await ctx.console.confirm(`Delete worktree at "${target}"? [y/N] `))) {
    return EXIT_CANCELLED;
  }
  await removeWorktree(ctx.repo.mainWorktree, target);
  printDestination(ctx.console, ctx.repo.mainWorktree);
  return 0;
}

export async function createWorktreeForBranchAction(
  ctx: ActionContext,
  branch: string,
  target: string,
): Promise<number> {
  if (!(await ctx.console.confirm(`Create worktree for "${branch}" at "${target}"? [y/N] `))) {
    return EXIT_CANCELLED;
  }
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

export async function createNewWorktreeAction(ctx: ActionContext): Promise<number> {
  const ref = ctx.repo.defaultBranchRef;
  if (!ref) throw new CdwtError("failed to detect the default branch");

  const branch = await readNewBranchName(ctx);
  if (branch === null) return EXIT_CANCELLED;
  const target = makeBranchPath(branch, ctx.repo.mainWorktree, ctx.repo.repoName);
  if (
    !(await ctx.console.confirm(
      `Create worktree for "${branch} from ${ref}" at "${target}"? [y/N] `,
    ))
  ) {
    return EXIT_CANCELLED;
  }
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
  if (
    !(await ctx.console.confirm(`Create worktree for "PR #${prNumber}" at "${target}"? [y/N] `))
  ) {
    return EXIT_CANCELLED;
  }
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

async function readNewBranchName(ctx: ActionContext): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_BRANCH_PROMPT_RETRIES; attempt++) {
    const raw = await ctx.console.ask("New branch name: ");
    if (raw === null) return null;
    const branch = raw.trim();
    if (branch === "") return null;
    if (!(await checkRefFormat(ctx.repo.cwd, branch))) {
      ctx.console.errln(`cdwt: invalid branch name: ${branch}`);
      continue;
    }
    if (await branchExists(ctx.repo.cwd, branch)) {
      ctx.console.errln(`cdwt: branch already exists: ${branch}`);
      continue;
    }
    if (ctx.branchesWithWorktree.has(branch)) {
      ctx.console.errln(`cdwt: branch already has a worktree: ${branch}`);
      continue;
    }
    return branch;
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
