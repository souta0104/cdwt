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
  it("emits sections in order: main → wt → pr → br", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 7, branch: "pr-branch", title: "Add cool thing" }],
      localBranches: ["main", "feature", "draft"],
      home: HOME,
    });
    const sections = lines.map((l) => l.section);
    const indices = {
      main: sections.indexOf("main"),
      wt: sections.indexOf("wt"),
      pr: sections.indexOf("pr"),
      br: sections.indexOf("br"),
    };
    expect(indices.main).toBeLessThan(indices.wt);
    expect(indices.wt).toBeLessThan(indices.pr);
    expect(indices.pr).toBeLessThan(indices.br);
  });

  it("marks the main entry with [current] when invoked from the main worktree", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    const main = lines.find((l) => l.section === "main");
    expect(main?.name).toBe("repo [current]");
    expect(main?.shortPath).toBe(".");
  });

  it("uses 'detached@<short-sha>' label for detached worktrees", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    const detached = lines
      .filter((l) => l.section === "wt")
      .find((l) => l.fullPath.endsWith("repo-detached"));
    expect(detached?.name).toBe("detached@ccccccc");
  });

  it("does not emit a synthetic 'new worktree' line - that is handled by the /new slash command", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: [],
      home: HOME,
    });
    expect(lines.find((l) => l.kind === "branch" && l.name === "create new worktree")).toBeUndefined();
    // Also confirm there is no row whose only purpose is creation.
    expect(lines.every((l) => l.section === "main" || l.section === "wt" || l.section === "br" || l.section === "pr")).toBe(true);
  });

  it("excludes non-main branches that already have a worktree from the branch section", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: ["main", "feature", "draft"],
      home: HOME,
    });
    const branchNames = lines.filter((l) => l.section === "br").map((l) => l.name);
    expect(branchNames).toEqual(["main", "draft"]);
  });

  it("excludes a local branch when it appears as the head of an open PR", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 9, branch: "pr-only", title: "x" }],
      localBranches: ["pr-only", "draft"],
      home: HOME,
    });
    const branchNames = lines.filter((l) => l.section === "br").map((l) => l.name);
    expect(branchNames).toEqual(["draft"]);
  });

  it("points a PR entry at the existing worktree path when its branch is checked out", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 1, branch: "feature", title: "x" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "pr");
    expect(pr?.destination).toBe("/Users/me/dev/repo-feature");
  });

  it("points a PR entry at a new pr-N path when no worktree exists for it", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 42, branch: "from-fork", title: "x" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "pr");
    expect(pr?.destination).toBe("/Users/me/dev/repo-pr-42");
  });

  it("renders branch entries with sibling-directory destinations", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [],
      localBranches: ["draft/notes"],
      home: HOME,
    });
    const branch = lines.find((l) => l.section === "br");
    expect(branch?.destination).toBe("/Users/me/dev/repo-draft-notes");
  });

  it("points a PR entry whose head IS the main branch at a fresh pr-N path, not the main worktree", () => {
    const lines = buildSections({
      repo: makeRepo(),
      prs: [{ number: 99, branch: "main", title: "release prep" }],
      localBranches: [],
      home: HOME,
    });
    const pr = lines.find((l) => l.section === "pr");
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
    expect(counts.get("main")).toBe(1);
    expect(counts.get("wt")).toBe(2);
    expect(counts.get("pr")).toBe(1);
    expect(counts.get("br")).toBe(1);
  });
});

describe("deriveBranchesWithWorktree", () => {
  it("collects branches from non-main worktrees and excludes the main one", () => {
    const repo: RepoContext = {
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
