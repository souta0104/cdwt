import path from "node:path";

export interface DisplayPathOptions {
  path: string;
  mainWorktree: string;
  mainParent: string;
  home: string;
}

/**
 * Mirrors the bash `display_path` helper.
 * Collapses paths into `.`, `./...`, `../...`, or `~/...` when possible.
 */
export function displayPath({
  path: target,
  mainWorktree,
  mainParent,
  home,
}: DisplayPathOptions): string {
  if (target === mainWorktree) return ".";
  if (mainWorktree && target.startsWith(`${mainWorktree}/`)) {
    return `./${target.slice(mainWorktree.length + 1)}`;
  }
  if (mainParent && target.startsWith(`${mainParent}/`)) {
    return `../${target.slice(mainParent.length + 1)}`;
  }
  if (home && target.startsWith(`${home}/`)) {
    return `~/${target.slice(home.length + 1)}`;
  }
  return target;
}

/**
 * Mirrors the bash branch-to-slug logic used to derive worktree directory names.
 * Replaces `/`, spaces, and any non-[A-Za-z0-9._-] character with `-`,
 * then trims leading/trailing dashes. Empty results fall back to `worktree`.
 */
export function slugifyBranch(branch: string): string {
  let slug = branch.replace(/[/ ]/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  slug = slug.replace(/^-+/, "").replace(/-+$/, "");
  if (slug === "") return "worktree";
  return slug;
}

export function makeBranchPath(branch: string, mainWorktree: string, repoName: string): string {
  const parent = path.dirname(mainWorktree);
  return `${parent}/${repoName}-${slugifyBranch(branch)}`;
}

export function makePrPath(prNumber: number, mainWorktree: string, repoName: string): string {
  const parent = path.dirname(mainWorktree);
  return `${parent}/${repoName}-pr-${prNumber}`;
}
