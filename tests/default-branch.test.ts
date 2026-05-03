import { describe, expect, it } from "vitest";
import { resolveDefaultBranch } from "../src/core/default-branch.js";

const empty = new Set<string>();

describe("resolveDefaultBranch", () => {
  it("prefers the remote HEAD when present (stripping origin/)", () => {
    const result = resolveDefaultBranch({
      remoteHead: "origin/main",
      mainWorktreeBranch: "feature",
      localBranches: new Set(["main", "feature"]),
      remoteBranches: new Set(["main"]),
      worktreeBranches: new Set(["main", "feature"]),
    });
    expect(result).toEqual({ branch: "main", ref: "main" });
  });

  it("uses the main worktree branch when remote HEAD is unavailable", () => {
    const result = resolveDefaultBranch({
      remoteHead: null,
      mainWorktreeBranch: "trunk",
      localBranches: new Set(["trunk"]),
      remoteBranches: empty,
      worktreeBranches: new Set(["trunk"]),
    });
    expect(result).toEqual({ branch: "trunk", ref: "trunk" });
  });

  it("falls back to 'main' or 'master' when nothing else is known", () => {
    const result = resolveDefaultBranch({
      remoteHead: null,
      mainWorktreeBranch: null,
      localBranches: empty,
      remoteBranches: new Set(["master"]),
      worktreeBranches: empty,
    });
    expect(result).toEqual({ branch: "master", ref: "origin/master" });
  });

  it("returns origin/<branch> when only the remote ref exists", () => {
    const result = resolveDefaultBranch({
      remoteHead: "origin/develop",
      mainWorktreeBranch: null,
      localBranches: empty,
      remoteBranches: new Set(["develop"]),
      worktreeBranches: empty,
    });
    expect(result).toEqual({ branch: "develop", ref: "origin/develop" });
  });

  it("returns the branch name when only a worktree has it", () => {
    const result = resolveDefaultBranch({
      remoteHead: "origin/develop",
      mainWorktreeBranch: null,
      localBranches: empty,
      remoteBranches: empty,
      worktreeBranches: new Set(["develop"]),
    });
    expect(result).toEqual({ branch: "develop", ref: "develop" });
  });

  it("returns null ref when the inferred branch cannot be resolved anywhere", () => {
    const result = resolveDefaultBranch({
      remoteHead: "origin/ghost",
      mainWorktreeBranch: null,
      localBranches: empty,
      remoteBranches: empty,
      worktreeBranches: empty,
    });
    expect(result).toEqual({ branch: "ghost", ref: null });
  });

  it("returns null branch when nothing can be inferred at all", () => {
    const result = resolveDefaultBranch({
      remoteHead: null,
      mainWorktreeBranch: null,
      localBranches: empty,
      remoteBranches: empty,
      worktreeBranches: empty,
    });
    expect(result).toEqual({ branch: null, ref: null });
  });
});
