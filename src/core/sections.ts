import type { DisplayLine, PullRequest, RepoContext, SectionKey, Worktree } from "../types.js";
import { displayPath, makeBranchPath, makePrPath } from "./paths.js";

export interface BuildSectionsInput {
  repo: RepoContext;
  prs: readonly PullRequest[];
  /** Local branches (refs/heads/*) - excluded if already a worktree or PR head. */
  localBranches: readonly string[];
  home: string;
}

/**
 * Set of branches that are already checked out in a non-main worktree.
 *
 * Note: matches bash behaviour - the main worktree's branch is intentionally
 * NOT added here, so the local branch section still surfaces the default
 * branch (which lets the user e.g. `git worktree add` it elsewhere later).
 */
export function deriveBranchesWithWorktree(repo: RepoContext): Set<string> {
  const set = new Set<string>();
  for (const wt of repo.worktrees) {
    if (wt.branch && wt.path !== repo.mainWorktree) {
      set.add(wt.branch);
    }
  }
  return set;
}

/**
 * Build the ordered list of selectable entries shown across sections.
 * Order matches the bash version exactly:
 *   1. root, 2. new worktree, 3. worktree, 4. delete worktree,
 *   5. github pr, 6. local branch.
 */
export function buildSections({
  repo,
  prs,
  localBranches,
  home,
}: BuildSectionsInput): DisplayLine[] {
  const lines: DisplayLine[] = [];
  const branchesWithWorktree = deriveBranchesWithWorktree(repo);
  const prBranches = new Set<string>();

  // 1. root
  const rootMarker = repo.mainWorktree === repo.currentPath ? " [current]" : "";
  lines.push(
    line({
      kind: "worktree",
      section: "root",
      name: `${repo.repoName}${rootMarker}`,
      shortPath: ".",
      fullPath: repo.mainWorktree,
      destination: repo.mainWorktree,
      branch: "",
    }),
  );

  // 2. new worktree
  if (repo.defaultBranchRef) {
    lines.push(
      line({
        kind: "new",
        section: "new worktree",
        name: "create new worktree",
        shortPath: `from ${repo.defaultBranchRef}`,
        fullPath: "",
        destination: "",
        branch: "",
      }),
    );
  }

  // 3. existing worktrees (skip main)
  for (const wt of repo.worktrees) {
    if (wt.path === repo.mainWorktree) continue;
    const label = worktreeLabel(wt, repo.currentPath);
    lines.push(
      line({
        kind: "worktree",
        section: "worktree",
        name: label,
        shortPath: displayPath({
          path: wt.path,
          mainWorktree: repo.mainWorktree,
          mainParent: repo.mainParent,
          home,
        }),
        fullPath: wt.path,
        destination: wt.path,
        branch: wt.branch ?? "",
      }),
    );
  }

  // 4. delete worktree (skip main)
  for (const wt of repo.worktrees) {
    if (wt.path === repo.mainWorktree) continue;
    const label = worktreeLabel(wt, repo.currentPath);
    const shortPath = displayPath({
      path: wt.path,
      mainWorktree: repo.mainWorktree,
      mainParent: repo.mainParent,
      home,
    });
    lines.push(
      line({
        kind: "delete",
        section: "delete worktree",
        name: `delete ${label}`,
        shortPath,
        fullPath: wt.path,
        destination: wt.path,
        branch: wt.branch ?? "",
      }),
    );
  }

  // 5. github pr
  for (const pr of prs) {
    prBranches.add(pr.branch);
    const existingWorktreePath = findNonMainWorktreePathForBranch(
      repo.worktrees,
      pr.branch,
      repo.mainWorktree,
    );
    const targetPath =
      existingWorktreePath ?? makePrPath(pr.number, repo.mainWorktree, repo.repoName);
    lines.push(
      line({
        kind: "pr",
        section: "github pr",
        name: `#${pr.number} ${pr.title}`,
        shortPath: displayPath({
          path: targetPath,
          mainWorktree: repo.mainWorktree,
          mainParent: repo.mainParent,
          home,
        }),
        fullPath: targetPath,
        destination: targetPath,
        branch: pr.branch,
        prNumber: pr.number,
      }),
    );
  }

  // 6. local branches without worktree, not already shown as a PR head
  for (const branch of localBranches) {
    if (branchesWithWorktree.has(branch)) continue;
    if (prBranches.has(branch)) continue;
    const targetPath = makeBranchPath(branch, repo.mainWorktree, repo.repoName);
    lines.push(
      line({
        kind: "branch",
        section: "local branch",
        name: branch,
        shortPath: displayPath({
          path: targetPath,
          mainWorktree: repo.mainWorktree,
          mainParent: repo.mainParent,
          home,
        }),
        fullPath: targetPath,
        destination: targetPath,
        branch,
      }),
    );
  }

  return lines;
}

export function sectionCounts(lines: readonly DisplayLine[]): Map<SectionKey, number> {
  const counts = new Map<SectionKey, number>();
  for (const l of lines) {
    counts.set(l.section, (counts.get(l.section) ?? 0) + 1);
  }
  return counts;
}

interface BuildLineInput {
  kind: DisplayLine["kind"];
  section: DisplayLine["section"];
  name: string;
  shortPath: string;
  fullPath: string;
  destination: string;
  branch: string;
  prNumber?: number;
}

function line(input: BuildLineInput): DisplayLine {
  return {
    kind: input.kind,
    section: input.section,
    name: input.name,
    shortPath: input.shortPath,
    fullPath: input.fullPath,
    destination: input.destination,
    branch: input.branch,
    prNumber: input.prNumber ?? null,
  };
}

function worktreeLabel(wt: Worktree, currentPath: string): string {
  const baseLabel = wt.branch
    ? wt.branch
    : wt.head
      ? `detached@${wt.head.slice(0, 7)}`
      : "detached";
  const marker = wt.path === currentPath ? " [current]" : "";
  return `${baseLabel}${marker}`;
}

/**
 * Skip the main worktree on purpose: a PR whose head branch matches the
 * default branch should still create a fresh `repo-pr-<n>` directory rather
 * than try to overwrite the main worktree with a detached checkout.
 */
function findNonMainWorktreePathForBranch(
  worktrees: readonly Worktree[],
  branch: string,
  mainWorktree: string,
): string | null {
  for (const wt of worktrees) {
    if (wt.path === mainWorktree) continue;
    if (wt.branch === branch) return wt.path;
  }
  return null;
}
