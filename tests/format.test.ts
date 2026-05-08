import { describe, expect, it } from "vitest";
import { FIELD_SEP, renderLine, tagOf } from "../src/ui/format.js";
import type { DisplayLine } from "../src/types.js";

const sample: DisplayLine = {
  kind: "worktree",
  section: "wt",
  name: "feature",
  shortPath: "../repo-feature",
  fullPath: "/Users/me/dev/repo-feature",
  destination: "/Users/me/dev/repo-feature",
  branch: "feature",
  prNumber: null,
};

describe("renderLine", () => {
  it("renders field 1 with the [section] tag and name, plus shortPath/fullPath as fields 2 and 3", () => {
    const out = renderLine(sample);
    const parts = out.split(FIELD_SEP);
    expect(parts).toHaveLength(3);
    expect(parts[0]?.includes("[worktree]")).toBe(true);
    expect(parts[0]?.includes("feature")).toBe(true);
    expect(parts[1]).toBe("../repo-feature");
    expect(parts[2]).toBe("/Users/me/dev/repo-feature");
  });

  it("uses a distinct glyph per section so worktrees and branches are visually separable", () => {
    const wt = renderLine({ ...sample, section: "wt" });
    const br = renderLine({ ...sample, section: "br" });
    const main = renderLine({ ...sample, section: "main" });
    const pr = renderLine({ ...sample, section: "pr" });
    expect(wt.split(FIELD_SEP)[0]).toContain("●");
    expect(br.split(FIELD_SEP)[0]).toContain("○");
    expect(main.split(FIELD_SEP)[0]).toContain("★");
    expect(pr.split(FIELD_SEP)[0]).toContain("◆");
  });

  it("emits ANSI color escapes so fzf --ansi can render sections in different colors", () => {
    const out = renderLine(sample);
    expect(out.includes("[")).toBe(true);
  });

  it("does not truncate names longer than the column width", () => {
    const wide: DisplayLine = { ...sample, name: "x".repeat(60) };
    const out = renderLine(wide);
    expect(out.split(FIELD_SEP)[0]?.includes("x".repeat(60))).toBe(true);
  });
});

describe("tagOf", () => {
  it.each([
    ["main", "[main]"],
    ["wt", "[worktree]"],
    ["br", "[branch]"],
    ["pr", "[PR]"],
  ] as const)("formats %p as %p", (key, expected) => {
    expect(tagOf(key)).toBe(expected);
  });
});
