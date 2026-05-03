import path from "node:path";
import { realpath } from "node:fs/promises";
import { CdwtError } from "../errors.js";
import { parseWorktreeList } from "../core/git-parse.js";
import type { Worktree } from "../types.js";
import type { ConsoleIO } from "./console.js";
import { run } from "./exec.js";

export interface GitContext {
  cwd: string;
  gitRoot: string;
  gitCommonDir: string;
  expectedMainWorktree: string;
}

export async function loadGitContext(cwd: string): Promise<GitContext> {
  let realCwd: string;
  try {
    realCwd = await realpath(cwd);
  } catch {
    throw new CdwtError(`invalid working directory: ${cwd}`);
  }
  const root = await runGit(["rev-parse", "--show-toplevel"], { cwd: realCwd });
  if (root.exitCode !== 0) {
    throw new CdwtError("not inside a git worktree");
  }
  const commonDirResult = await runGit(["rev-parse", "--git-common-dir"], { cwd: realCwd });
  if (commonDirResult.exitCode !== 0) {
    throw new CdwtError("failed to resolve git common dir");
  }
  let commonDir = commonDirResult.stdout.trim();
  if (!path.isAbsolute(commonDir)) {
    commonDir = await realpath(path.resolve(realCwd, commonDir));
  }
  return {
    cwd: realCwd,
    gitRoot: root.stdout.trim(),
    gitCommonDir: commonDir,
    expectedMainWorktree: path.dirname(commonDir),
  };
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const result = await runGit(["worktree", "list", "--porcelain"], { cwd });
  if (result.exitCode !== 0) {
    throw new CdwtError("failed to list git worktrees");
  }
  return parseWorktreeList(result.stdout);
}

export async function symbolicRef(cwd: string, ref: string): Promise<string | null> {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", ref], { cwd });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function listLocalBranches(cwd: string): Promise<string[]> {
  const result = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    cwd,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

export async function listRemoteBranches(cwd: string): Promise<string[]> {
  const result = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    { cwd },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0 && line !== "origin/HEAD")
    .map((line) => line.replace(/^origin\//, ""));
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd,
  });
  return result.exitCode === 0;
}

export async function checkRefFormat(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(["check-ref-format", "--branch", branch], { cwd });
  return result.exitCode === 0;
}

export async function isGitIgnored(cwd: string, relativePath: string): Promise<boolean> {
  const result = await runGit(["check-ignore", "-q", "--", relativePath], { cwd });
  return result.exitCode === 0;
}

export async function listIgnoredFiles(cwd: string): Promise<string[]> {
  const result = await runGit(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
    cwd,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.split("\0").filter((p) => p.length > 0);
}

/**
 * For commands that produce useful progress output (worktree add / remove),
 * we let git own the user's terminal. That way the output is identical to
 * `git worktree add` invoked by hand and we never duplicate it.
 */
async function runGitInherited(args: readonly string[], cwd: string): Promise<number> {
  const result = await run("git", args, { cwd, inheritStdio: true });
  return result.exitCode;
}

export async function addWorktreeForBranch(
  cwd: string,
  destination: string,
  branch: string,
): Promise<void> {
  const code = await runGitInherited(["worktree", "add", destination, branch], cwd);
  if (code !== 0) {
    throw new CdwtError(`git worktree add failed for ${branch} (exit ${code})`);
  }
}

export async function addWorktreeNewBranch(
  cwd: string,
  destination: string,
  branch: string,
  baseRef: string,
): Promise<void> {
  const code = await runGitInherited(["worktree", "add", "-b", branch, destination, baseRef], cwd);
  if (code !== 0) {
    throw new CdwtError(`git worktree add -b ${branch} from ${baseRef} failed (exit ${code})`);
  }
}

export async function addWorktreeDetached(cwd: string, destination: string): Promise<void> {
  const code = await runGitInherited(["worktree", "add", "--detach", destination], cwd);
  if (code !== 0) {
    throw new CdwtError(`git worktree add --detach failed at ${destination} (exit ${code})`);
  }
}

export async function removeWorktree(cwd: string, target: string): Promise<void> {
  const code = await runGitInherited(["worktree", "remove", target], cwd);
  if (code !== 0) {
    throw new CdwtError(`git worktree remove failed for ${target} (exit ${code})`);
  }
}

/**
 * Best-effort cleanup used by rollback paths. Does not throw; instead reports
 * a clear remediation hint on the supplied console, so a leaked worktree can
 * be cleaned up by the user.
 */
export async function removeWorktreeForce(
  cwd: string,
  target: string,
  console: ConsoleIO,
): Promise<void> {
  const result = await run("git", ["worktree", "remove", "--force", target], { cwd });
  if (result.exitCode === 0) return;
  if (result.stderr) console.err(result.stderr);
  console.errln(
    `cdwt: warning: failed to remove orphan worktree at ${target}; clean up with: git worktree remove --force "${target}"`,
  );
}

async function runGit(args: readonly string[], options: { cwd: string }) {
  return run("git", args, { cwd: options.cwd });
}
