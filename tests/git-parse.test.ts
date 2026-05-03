import { describe, expect, it } from "vitest";
import { parseWorktreeList } from "../src/core/git-parse.js";

describe("parseWorktreeList", () => {
  it("parses a typical porcelain output with main, branch, and detached worktrees", () => {
    const output = [
      "worktree /repo",
      "HEAD aaaaaaaa",
      "branch refs/heads/main",
      "",
      "worktree /repo-feature",
      "HEAD bbbbbbbb",
      "branch refs/heads/feature/x",
      "",
      "worktree /repo-detached",
      "HEAD cccccccc",
      "detached",
      "",
    ].join("\n");

    expect(parseWorktreeList(output)).toEqual([
      { path: "/repo", branch: "main", head: "aaaaaaaa" },
      { path: "/repo-feature", branch: "feature/x", head: "bbbbbbbb" },
      { path: "/repo-detached", branch: null, head: "cccccccc" },
    ]);
  });

  it("flushes the final worktree without a trailing blank line", () => {
    const output = ["worktree /a", "HEAD ffff", "branch refs/heads/main"].join("\n");
    expect(parseWorktreeList(output)).toEqual([{ path: "/a", branch: "main", head: "ffff" }]);
  });

  it("ignores unknown attributes such as locked or prunable", () => {
    const output = ["worktree /a", "HEAD 1234", "branch refs/heads/main", "locked", ""].join("\n");
    expect(parseWorktreeList(output)).toEqual([{ path: "/a", branch: "main", head: "1234" }]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("strips trailing CR for CRLF inputs", () => {
    const output = "worktree /a\r\nHEAD 1\r\nbranch refs/heads/main\r\n\r\n";
    expect(parseWorktreeList(output)).toEqual([{ path: "/a", branch: "main", head: "1" }]);
  });
});
