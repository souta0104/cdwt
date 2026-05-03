import { describe, expect, it } from "vitest";
import { buildSections, deriveBranchesWithWorktree, sectionCounts } from "../src/core/sections.js";
import type { RepoContext, Worktree } from "../src/types.js";

const HOME = "/Users/me";

function makeRepo(overrides: Partial<RepoContext> = {}): RepoContext {
  const worktrees: Worktree[] = overrides.worktrees ?? [
    { path: "/Users/me/dev/repo", branch: "main", head: "aaaaaaa" },
    { path: "/Users/me/dev/repo-feature", branch: "feature", head: "bbbbbbb" },
    { path: "/Users/me/dev/repo-detached", branch: null, head: "ccccccc1" },
  ];
  return {
    mainWorktree: "/Users/me/dev/repo",
    mainParent: "/Users/me/dev",
    repoName: "repo",
    defaultBranch: "main",
    defaultBranchRef: "main",
    mainWorktreeBranch: "main",
    worktrees,
    cwd: "/Users/me/dev/repo",
    currentPath: "/Users/me/dev/repo",
    ...overrides,
  };
}

describe("buildSections", () => {
  it("emits sections in the documented order", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 7, branch: "pr-branch", title: "Add cool thing" }],
      localBranches: ["main", "feature", "draft"],
      home: HOME,
    });
    const sections = lines.map((l) => l.section);
    const indices = {
      root: sections.indexOf("root"),
      newWorktree: sections.indexOf("new worktree"),
      worktree: sections.indexOf("worktree"),
      delete: sections.indexOf("delete worktree"),
      pr: sections.indexOf("github pr"),
      branch: sections.indexOf("local branch"),
    };
    expect(indices.root).toBeLessThan(indices.newWorktree);
    expect(indices.newWorktree).toBeLessThan(indices.worktree);
    expect(indices.worktree).toBeLessThan(indices.delete);
    expect(indices.delete).toBeLessThan(indices.pr);
    expect(indices.pr).toBeLessThan(indices.branch);
  });

  it("marks the root entry with [current] when invoked from the main worktree", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    const root = lines.find((l) => l.section === "root");
    expect(root?.name).toBe("repo [current]");
    expect(root?.shortPath).toBe(".");
  });

  it("uses 'detached@<short-sha>' label for detached worktrees", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    const detached = lines
      .filter((l) => l.section === "worktree")
      .find((l) => l.fullPath.endsWith("repo-detached"));
    expect(detached?.name).toBe("detached@ccccccc");
  });

  it("skips the new worktree section when no defaultBranchRef is available", () => {
    const lines = buildSections({
      repo: makeRepo({ defaultBranchRef: null, defaultBranch: null }),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    expect(lines.find((l) => l.section === "new worktree")).toBeUndefined();
  });

  it("excludes non-main branches that already have a worktree from the local branch section", () => {
    // Note: matches bash behaviour - the main worktree's branch ("main") is
    // intentionally NOT added to the exclusion set, so it still appears here.
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: ["main", "feature", "draft"],
      home: HOME,
    });
    const branchNames = lines.filter((l) => l.section === "local branch").map((l) => l.name);
    expect(branchNames).toEqual(["main", "draft"]);
  });

  it("excludes a local branch when it appears as the head of an open PR", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 9, branch: "pr-only", title: "x" }],
      localBranches: ["pr-only", "draft"],
      home: HOME,
    });
    const branchNames = lines.filter((l) => l.section === "local branch").map((l) => l.name);
    expect(branchNames).toEqual(["draft"]);
  });

  it("points a PR entry at the existing worktree path when its branch is checked out", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 1, branch: "feature", title: "x" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "github pr");
    expect(pr?.destination).toBe("/Users/me/dev/repo-feature");
  });

  it("points a PR entry at a new pr-N path when no worktree exists for it", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 42, branch: "from-fork", title: "x" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "github pr");
    expect(pr?.destination).toBe("/Users/me/dev/repo-pr-42");
  });

  it("renders branch entries with sibling-directory destinations", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: ["draft/notes"],
      home: HOME,
    });
    const branch = lines.find((l) => l.section === "local branch");
    expect(branch?.destination).toBe("/Users/me/dev/repo-draft-notes");
  });

  it("emits one delete entry per non-main worktree", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    const deletes = lines.filter((l) => l.section === "delete worktree");
    expect(deletes).toHaveLength(2);
    expect(deletes.every((l) => l.kind === "delete")).toBe(true);
  });

  it("points a PR entry whose head IS the main branch at a fresh pr-N path, not the main worktree", () => {
    // Critical bug regression: previously findWorktreePathForBranch would
    // match the main worktree's branch and try to create a detached worktree
    // on top of `mainWorktree` itself.
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 99, branch: "main", title: "release prep" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "github pr");
    expect(pr?.destination).toBe("/Users/me/dev/repo-pr-99");
    expect(pr?.destination).not.toBe("/Users/me/dev/repo");
  });

  it("counts entries per section", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 7, branch: "pr-only", title: "t" }],
      localBranches: ["draft"],
      home: HOME,
    });
    const counts = sectionCounts(lines);
    expect(counts.get("root")).toBe(1);
    expect(counts.get("new worktree")).toBe(1);
    expect(counts.get("worktree")).toBe(2);
    expect(counts.get("delete worktree")).toBe(2);
    expect(counts.get("github pr")).toBe(1);
    expect(counts.get("local branch")).toBe(1);
  });
});

describe("deriveBranchesWithWorktree", () => {
  it("collects branches from non-main worktrees and excludes the main one", () => {
    const repo = {
      mainWorktree: "/repo",
      mainParent: "/",
      repoName: "repo",
      defaultBranch: "main",
      defaultBranchRef: "main",
      mainWorktreeBranch: "main",
      worktrees: [
        { path: "/repo", branch: "main", head: "a" },
        { path: "/repo-feature", branch: "feature", head: "b" },
        { path: "/repo-detached", branch: null, head: "c" },
      ],
      cwd: "/repo",
      currentPath: "/repo",
    };
    const set = deriveBranchesWithWorktree(repo);
    expect(Array.from(set).sort()).toEqual(["feature"]);
  });
});
