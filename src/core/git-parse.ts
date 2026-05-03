import type { Worktree } from "../types.js";

/**
 * Parse the output of `git worktree list --porcelain` into a structured list.
 * The porcelain format places one attribute per line and separates worktrees
 * with blank lines. Lines we recognise: `worktree <path>`, `branch <ref>`,
 * `HEAD <sha>`, `detached`. Other lines (locked, prunable, ...) are ignored.
 */
export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: { path: string; branch: string | null; head: string | null } | null = null;

  const flush = () => {
    if (current && current.path) {
      worktrees.push({ ...current });
    }
    current = null;
  };

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length), branch: null, head: null };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }
  flush();
  return worktrees;
}
