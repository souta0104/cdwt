import path from "node:path";

export class UnsafeCopyPathError extends Error {
  constructor(public readonly value: string) {
    super(`refusing unsafe copy path: ${value}`);
    this.name = "UnsafeCopyPathError";
  }
}

/**
 * Reject paths that are empty, absolute, or escape the worktree.
 * Mirrors the bash `validate_copy_path` helper.
 */
export function validateCopyPath(relativePath: string): void {
  if (
    relativePath === "" ||
    relativePath.startsWith("/") ||
    relativePath.includes("/../") ||
    relativePath.startsWith("../") ||
    relativePath === ".."
  ) {
    throw new UnsafeCopyPathError(relativePath);
  }
}

/**
 * Convert user-facing copy patterns into git pathspecs suitable for
 * `git ls-files --others --ignored --exclude-standard -- <pathspecs>`.
 *
 * The result intentionally over-matches — callers should apply
 * `copyPatternMatchesPath` as a secondary filter to enforce exact semantics.
 */
export function patternsToPathspecs(patterns: readonly string[]): string[] {
  const specs: string[] = [];
  for (const p of patterns) {
    if (p.includes("/")) {
      specs.push(`:(glob)${p}`);
    } else {
      specs.push(`:(glob)**/${p}`);
    }
  }
  return specs;
}

/**
 * Glob-ish pattern matcher that mirrors the bash `copy_pattern_matches_path` rules:
 * - patterns containing `/` are matched as full repo-relative paths via fnmatch
 * - patterns without `/` match the basename anywhere in the path, the path itself,
 *   any directory prefix (`pattern/...`), or any suffix (`.../pattern` / `.../pattern/...`)
 */
export function copyPatternMatchesPath(relativePath: string, patterns: readonly string[]): boolean {
  const base = path.basename(relativePath);
  for (const pattern of patterns) {
    validateCopyPath(pattern);
    if (pattern.includes("/")) {
      if (fnmatch(relativePath, pattern)) return true;
      continue;
    }
    if (fnmatch(base, pattern)) return true;
    if (relativePath === pattern) return true;
    if (relativePath.startsWith(`${pattern}/`)) return true;
    if (relativePath.endsWith(`/${pattern}`)) return true;
    if (relativePath.includes(`/${pattern}/`)) return true;
  }
  return false;
}

/**
 * Translate a bash `[[ str == pattern ]]`-style glob into a RegExp and test it.
 * Without `shopt -s globstar` (bash default), `*` matches any character
 * including `/`. `**` collapses to the same thing. We therefore use `.*` for
 * both. `?` matches any single character (including `/`). Bracket expressions
 * `[..]` are passed through.
 */
function fnmatch(input: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      regex += ".*";
      while (pattern[i + 1] === "*") i++;
    } else if (ch === "?") {
      regex += ".";
    } else if (ch === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        regex += "\\[";
      } else {
        regex += pattern.slice(i, close + 1);
        i = close;
      }
    } else if (/[.+^${}()|\\]/.test(ch)) {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }
  regex += "$";
  return new RegExp(regex).test(input);
}
