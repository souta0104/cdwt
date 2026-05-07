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
 * Branches already checked out in a non-main worktree.
 *
 * The main worktree's branch is intentionally NOT included so the local
 * branch section still surfaces the default branch (lets the user create
 * another worktree of it if they want).
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
 * Build the unified picker line list. Order:
 *   1. main worktree
 *   2. linked worktrees
 *   3. PRs (if loaded)
 *   4. local branches without a worktree
 *
 * Slash commands (`/new`, `/delete`) handle creation and deletion, so this
 * list contains entities only - no synthetic action rows.
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

  const rootMarker = repo.mainWorktree === repo.currentPath ? " [current]" : "";
  lines.push(
    line({
      kind: "worktree",
      section: "main",
      name: `${repo.repoName}${rootMarker}`,
      shortPath: ".",
      fullPath: repo.mainWorktree,
      destination: repo.mainWorktree,
      branch: repo.mainWorktreeBranch ?? "",
    }),
  );

  for (const wt of repo.worktrees) {
    if (wt.path === repo.mainWorktree) continue;
    const label = worktreeLabel(wt, repo.currentPath);
    lines.push(
      line({
        kind: "worktree",
        section: "wt",
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
        section: "pr",
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

  for (const branch of localBranches) {
    if (branchesWithWorktree.has(branch)) continue;
    if (prBranches.has(branch)) continue;
    const targetPath = makeBranchPath(branch, repo.mainWorktree, repo.repoName);
    lines.push(
      line({
        kind: "branch",
        section: "br",
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
 * than overwrite the main worktree with a detached checkout.
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
