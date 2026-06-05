import { describe, expect, it } from "vitest";
import { UnsafeCopyPathError, copyPatternMatchesPath, patternsToPathspecs, validateCopyPath } from "../src/core/copy.js";

describe("validateCopyPath", () => {
  it.each(["", "/abs/path", "../escape", "..", "nested/../escape", "a/../b"])(
    "rejects %p",
    (input) => {
      expect(() => validateCopyPath(input)).toThrow(UnsafeCopyPathError);
    },
  );

  // `x..y` contains `..` but is a single path segment — not a parent-directory
  // reference. Only `..` as a full segment escapes the worktree, so this is
  // intentionally accepted.
  it.each([".env", "a/b/c", ".claude/settings.local.json", "x..y"])("accepts %p", (input) => {
    expect(() => validateCopyPath(input)).not.toThrow();
  });
});

describe("copyPatternMatchesPath", () => {
  it("matches a path with a slashed pattern via fnmatch", () => {
    expect(copyPatternMatchesPath(".claude/settings.local.json", [".claude/**"])).toBe(true);
    expect(copyPatternMatchesPath(".claude/foo/bar", [".claude/**"])).toBe(true);
  });

  it("does not match a slashed pattern when the prefix differs", () => {
    expect(copyPatternMatchesPath("other/x", [".claude/**"])).toBe(false);
  });

  it("matches the basename for patterns without /", () => {
    expect(copyPatternMatchesPath("nested/dir/CLAUDE.md", ["CLAUDE.md"])).toBe(true);
    expect(copyPatternMatchesPath("CLAUDE.md", ["CLAUDE.md"])).toBe(true);
  });

  it("matches a glob basename pattern across nested paths", () => {
    expect(copyPatternMatchesPath("nested/foo.local.json", ["*.local.json"])).toBe(true);
  });

  it("matches patterns without / when used as a directory name anywhere", () => {
    expect(copyPatternMatchesPath(".codex/skills/foo.txt", ["skills"])).toBe(true);
    expect(copyPatternMatchesPath("skills/foo.txt", ["skills"])).toBe(true);
    expect(copyPatternMatchesPath("foo/skills", ["skills"])).toBe(true);
  });

  it("returns false when no pattern matches", () => {
    expect(copyPatternMatchesPath("README.md", ["CLAUDE.md", "*.local.json"])).toBe(false);
  });

  it("rejects unsafe patterns by throwing", () => {
    expect(() => copyPatternMatchesPath("a", ["../bad"])).toThrow(UnsafeCopyPathError);
  });
});

describe("patternsToPathspecs", () => {
  it("wraps basename-only patterns with :(glob)**/", () => {
    expect(patternsToPathspecs([".claude", "CLAUDE.md"])).toEqual([
      ":(glob)**/.claude",
      ":(glob)**/CLAUDE.md",
    ]);
  });

  it("wraps patterns containing / with :(glob) only", () => {
    expect(patternsToPathspecs([".codex/skills/**"])).toEqual([
      ":(glob).codex/skills/**",
    ]);
  });

  it("handles mixed patterns", () => {
    expect(patternsToPathspecs(["*.local.json", ".claude/**"])).toEqual([
      ":(glob)**/*.local.json",
      ":(glob).claude/**",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(patternsToPathspecs([])).toEqual([]);
  });
});
