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
  it("starts with a padded [section] tag, then the name, then path columns", () => {
    const out = renderLine(sample);
    const parts = out.split(FIELD_SEP);
    expect(parts).toHaveLength(3);
    expect(parts[0]?.startsWith("[wt]")).toBe(true);
    expect(parts[0]?.includes("feature")).toBe(true);
    expect(parts[1]).toBe("../repo-feature");
    expect(parts[2]).toBe("/Users/me/dev/repo-feature");
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
    ["wt", "[wt]"],
    ["br", "[br]"],
    ["pr", "[pr]"],
  ] as const)("formats %p as %p", (key, expected) => {
    expect(tagOf(key)).toBe(expected);
  });
});
