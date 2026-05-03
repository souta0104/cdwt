export type SectionKey =
  | "root"
  | "worktree"
  | "new worktree"
  | "delete worktree"
  | "github pr"
  | "local branch";

export type DisplayKind = "worktree" | "delete" | "branch" | "new" | "pr";

export interface Worktree {
  /** Absolute path of the worktree. */
  path: string;
  /** Branch name (without refs/heads/ prefix), or null when detached / unborn. */
  branch: string | null;
  /** HEAD commit SHA, or null when unborn. */
  head: string | null;
}

export interface PullRequest {
  number: number;
  branch: string;
  title: string;
}

export interface CopyIgnoredConfig {
  paths: string[];
  patterns: string[];
}

export interface CdwtConfig {
  copyIgnored: CopyIgnoredConfig;
}

export interface DisplayLine {
  kind: DisplayKind;
  section: SectionKey;
  /** Left-aligned name shown in the selector (44 columns). */
  name: string;
  /** Short, human friendly path. */
  shortPath: string;
  /** Absolute destination path (empty for "new worktree"). */
  fullPath: string;
  /** Final destination to print on selection (empty until resolved). */
  destination: string;
  /** Branch the entry refers to (empty for root / new). */
  branch: string;
  /** PR number (only for github pr entries). */
  prNumber: number | null;
}

export interface RepoContext {
  /** Absolute path of the main worktree (i.e. the directory containing .git). */
  mainWorktree: string;
  /** Parent directory of mainWorktree. */
  mainParent: string;
  /** Repository directory name (basename of mainWorktree). */
  repoName: string;
  /** The default branch name (without origin/), or null when undetectable. */
  defaultBranch: string | null;
  /** Git ref usable as a base for `git worktree add -b`. */
  defaultBranchRef: string | null;
  /** Branch name on the main worktree (if any). */
  mainWorktreeBranch: string | null;
  /** Worktrees, including the main one. */
  worktrees: Worktree[];
  /** Current working directory (absolute, real path). */
  cwd: string;
  /** Path of the worktree the user invoked cdwt from. */
  currentPath: string;
}
