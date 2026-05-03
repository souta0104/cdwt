import { describe, expect, it } from "vitest";
import { FIELD_SEP, renderLine, renderSearchLine, sectionLabel } from "../src/ui/format.js";
import type { DisplayLine } from "../src/types.js";

const sample: DisplayLine = {
  kind: "worktree",
  section: "worktree",
  name: "feature",
  shortPath: "../repo-feature",
  fullPath: "/Users/me/dev/repo-feature",
  destination: "/Users/me/dev/repo-feature",
  branch: "feature",
  prNumber: null,
};

describe("renderLine", () => {
  it("pads the name to 44 columns and joins with the field separator", () => {
    const out = renderLine(sample);
    const parts = out.split(FIELD_SEP);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(44);
    expect(parts[0]?.startsWith("feature")).toBe(true);
    expect(parts[1]).toBe("../repo-feature");
    expect(parts[2]).toBe("/Users/me/dev/repo-feature");
  });

  it("does not truncate names longer than the column width", () => {
    const wide: DisplayLine = { ...sample, name: "x".repeat(60) };
    const out = renderLine(wide);
    expect(out.split(FIELD_SEP)[0]).toBe("x".repeat(60));
  });
});

describe("renderSearchLine", () => {
  it("prefixes the visible row with a [section] badge and embeds the inner triple", () => {
    const out = renderSearchLine(sample);
    const parts = out.split(FIELD_SEP);
    // [visible, name(44), shortPath, fullPath, fullPath]
    expect(parts).toHaveLength(5);
    expect(parts[0]).toContain("[worktree]");
    expect(parts[0]).toContain("feature");
    expect(parts[0]).toContain("../repo-feature");
    expect(parts[3]).toBe("/Users/me/dev/repo-feature");
    expect(parts[4]).toBe("/Users/me/dev/repo-feature");
  });
});

describe("sectionLabel", () => {
  it.each([
    ["root", 1, "root (1)"],
    ["github pr", 12, "github pr (12)"],
    ["local branch", 0, "local branch (0)"],
  ] as const)("formats %p with count %p as %p", (key, count, expected) => {
    expect(sectionLabel(key, count)).toBe(expected);
  });
});
