export interface ResolveDefaultBranchInput {
  /** Result of `git symbolic-ref --short refs/remotes/origin/HEAD`, or null. */
  remoteHead: string | null;
  /** Branch checked out on the main worktree (if any). */
  mainWorktreeBranch: string | null;
  /** Local branches that exist (refs/heads/*). */
  localBranches: ReadonlySet<string>;
  /** Remote branches under origin/* (without the leading `origin/`). */
  remoteBranches: ReadonlySet<string>;
  /** Branches checked out across worktrees. */
  worktreeBranches: ReadonlySet<string>;
}

export interface ResolvedDefaultBranch {
  branch: string | null;
  ref: string | null;
}

const FALLBACK_CANDIDATES = ["main", "master"] as const;

/**
 * Pure version of the bash `resolve_default_branch` helper.
 * Returns the inferred default branch name and a usable ref for `git worktree add`.
 */
export function resolveDefaultBranch(input: ResolveDefaultBranchInput): ResolvedDefaultBranch {
  let branch: string | null = null;

  if (input.remoteHead) {
    branch = input.remoteHead.startsWith("origin/")
      ? input.remoteHead.slice("origin/".length)
      : input.remoteHead;
  }

  if (!branch && input.mainWorktreeBranch) {
    branch = input.mainWorktreeBranch;
  }

  if (!branch) {
    for (const candidate of FALLBACK_CANDIDATES) {
      if (input.localBranches.has(candidate) || input.remoteBranches.has(candidate)) {
        branch = candidate;
        break;
      }
    }
  }

  if (!branch) {
    return { branch: null, ref: null };
  }

  if (input.localBranches.has(branch)) {
    return { branch, ref: branch };
  }
  if (input.remoteBranches.has(branch)) {
    return { branch, ref: `origin/${branch}` };
  }
  if (input.worktreeBranches.has(branch)) {
    return { branch, ref: branch };
  }
  return { branch, ref: null };
}
