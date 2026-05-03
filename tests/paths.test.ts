import { describe, expect, it } from "vitest";
import { displayPath, makeBranchPath, makePrPath, slugifyBranch } from "../src/core/paths.js";

describe("displayPath", () => {
  const opts = {
    mainWorktree: "/Users/me/dev/repo",
    mainParent: "/Users/me/dev",
    home: "/Users/me",
  } as const;

  it("returns '.' for the main worktree itself", () => {
    expect(displayPath({ path: "/Users/me/dev/repo", ...opts })).toBe(".");
  });

  it("returns './<rest>' for paths inside the main worktree", () => {
    expect(displayPath({ path: "/Users/me/dev/repo/src/file.ts", ...opts })).toBe("./src/file.ts");
  });

  it("returns '../<rest>' for sibling worktrees under the same parent", () => {
    expect(displayPath({ path: "/Users/me/dev/repo-feature", ...opts })).toBe("../repo-feature");
  });

  it("falls back to '~/<rest>' for paths under HOME but outside parent", () => {
    expect(displayPath({ path: "/Users/me/other/place", ...opts })).toBe("~/other/place");
  });

  it("returns the full path when nothing else matches", () => {
    expect(displayPath({ path: "/tmp/elsewhere", ...opts })).toBe("/tmp/elsewhere");
  });

  it("does not collapse a path that starts with a similar prefix but is not under main", () => {
    expect(displayPath({ path: "/Users/me/dev/repository-extra", ...opts })).toBe(
      "../repository-extra",
    );
  });
});

describe("slugifyBranch", () => {
  it("replaces / with -", () => {
    expect(slugifyBranch("feature/awesome")).toBe("feature-awesome");
  });

  it("replaces spaces with -", () => {
    expect(slugifyBranch("hot fix branch")).toBe("hot-fix-branch");
  });

  it("replaces non-[A-Za-z0-9._-] characters with -", () => {
    expect(slugifyBranch("release@2025#01")).toBe("release-2025-01");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyBranch("--draft--")).toBe("draft");
  });

  it("falls back to 'worktree' for empty results", () => {
    expect(slugifyBranch("///")).toBe("worktree");
    expect(slugifyBranch("")).toBe("worktree");
  });

  it("preserves dots and underscores", () => {
    expect(slugifyBranch("v1.2.3_rc1")).toBe("v1.2.3_rc1");
  });
});

describe("makeBranchPath", () => {
  it("derives a sibling directory under the repo parent", () => {
    expect(makeBranchPath("feature/x", "/Users/me/dev/repo", "repo")).toBe(
      "/Users/me/dev/repo-feature-x",
    );
  });
});

describe("makePrPath", () => {
  it("uses the pr-<n> naming scheme", () => {
    expect(makePrPath(42, "/Users/me/dev/repo", "repo")).toBe("/Users/me/dev/repo-pr-42");
  });
});
