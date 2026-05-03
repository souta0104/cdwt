import path from "node:path";
import { CdwtError } from "../errors.js";
import { resolveDefaultBranch } from "../core/default-branch.js";
import type { RepoContext } from "../types.js";
import {
  listLocalBranches,
  listRemoteBranches,
  listWorktrees,
  loadGitContext,
  symbolicRef,
} from "./git.js";

export async function loadRepoContext(cwd: string): Promise<RepoContext> {
  const git = await loadGitContext(cwd);
  const worktrees = await listWorktrees(git.cwd);
  const main = worktrees.find((wt) => wt.path === git.expectedMainWorktree);
  if (!main) {
    throw new CdwtError("failed to detect the main worktree");
  }
  const mainParent = path.dirname(main.path);
  const repoName = path.basename(main.path);

  const [remoteHead, localBranches, remoteBranches] = await Promise.all([
    symbolicRef(git.cwd, "refs/remotes/origin/HEAD"),
    listLocalBranches(git.cwd),
    listRemoteBranches(git.cwd),
  ]);
  const worktreeBranches = new Set<string>();
  for (const wt of worktrees) {
    if (wt.branch) worktreeBranches.add(wt.branch);
  }

  const { branch, ref } = resolveDefaultBranch({
    remoteHead,
    mainWorktreeBranch: main.branch,
    localBranches: new Set(localBranches),
    remoteBranches: new Set(remoteBranches),
    worktreeBranches,
  });

  return {
    mainWorktree: main.path,
    mainParent,
    repoName,
    defaultBranch: branch,
    defaultBranchRef: ref,
    mainWorktreeBranch: main.branch,
    worktrees,
    cwd: git.cwd,
    currentPath: git.gitRoot,
  };
}
