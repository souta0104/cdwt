import { describe, expect, it } from "vitest";
import { renderLine, renderSearchLine, FIELD_SEP } from "../src/ui/format.js";
import {
  buildRenderLookup,
  parseItemPickerOutput,
  parseSearchPickerOutput,
  parseSectionPickerOutput,
} from "../src/ui/fzf-parse.js";
import type { DisplayLine } from "../src/types.js";

const SECTION_LABELS = ["root (1)", "worktree (3)", "local branch (5)"];

describe("parseSectionPickerOutput", () => {
  it("treats empty stdout + non-zero exit as cancellation", () => {
    expect(parseSectionPickerOutput("", 130, SECTION_LABELS)).toEqual({
      cancelled: true,
      searchQuery: null,
      index: -1,
    });
  });

  it("returns esc cancellation when the expect key is esc", () => {
    const stdout = `\nesc\n`;
    expect(parseSectionPickerOutput(stdout, 0, SECTION_LABELS)).toEqual({
      cancelled: true,
      searchQuery: null,
      index: -1,
    });
  });

  it("forwards a non-empty query as a search request", () => {
    const stdout = `feat\n\n\n`;
    expect(parseSectionPickerOutput(stdout, 0, SECTION_LABELS)).toEqual({
      cancelled: false,
      searchQuery: "feat",
      index: -1,
    });
  });

  it("looks up the section label and returns its index", () => {
    const stdout = `\n\nworktree (3)\n`;
    expect(parseSectionPickerOutput(stdout, 0, SECTION_LABELS)).toEqual({
      cancelled: false,
      searchQuery: null,
      index: 1,
    });
  });

  it("cancels when the selected label does not match any known section", () => {
    const stdout = `\n\nunknown (4)\n`;
    expect(parseSectionPickerOutput(stdout, 0, SECTION_LABELS)).toEqual({
      cancelled: true,
      searchQuery: null,
      index: -1,
    });
  });
});

describe("parseItemPickerOutput", () => {
  it("treats empty stdout + non-zero exit as cancellation", () => {
    expect(parseItemPickerOutput("", 130)).toEqual({
      cancelled: true,
      action: "select",
      selectedRendered: null,
    });
  });

  it.each([
    ["esc", "esc"],
    ["tab", "next"],
    ["btab", "prev"],
  ] as const)("maps key %p to action %p", (key, action) => {
    const stdout = `${key}\n`;
    expect(parseItemPickerOutput(stdout, 0)).toEqual({
      cancelled: false,
      action,
      selectedRendered: null,
    });
  });

  it("returns the selected rendered line for a normal pick", () => {
    const rendered = "name padded                                 \x1f./short\x1f/full";
    const stdout = `\n${rendered}\n`;
    expect(parseItemPickerOutput(stdout, 0)).toEqual({
      cancelled: false,
      action: "select",
      selectedRendered: rendered,
    });
  });

  it("treats an empty selection (enter on empty list) as cancellation", () => {
    const stdout = `\n\n`;
    expect(parseItemPickerOutput(stdout, 0)).toEqual({
      cancelled: true,
      action: "select",
      selectedRendered: null,
    });
  });
});

describe("parseSearchPickerOutput", () => {
  it("treats empty stdout + non-zero exit as cancellation", () => {
    expect(parseSearchPickerOutput("", 130)).toEqual({
      cancelled: true,
      resetToSections: false,
      innerKey: null,
    });
  });

  it("returns to sections when the query is cleared", () => {
    const stdout = `\n\n\n`;
    expect(parseSearchPickerOutput(stdout, 0)).toEqual({
      cancelled: false,
      resetToSections: true,
      innerKey: null,
    });
  });

  it("returns to sections when esc is pressed", () => {
    const stdout = `feature\nesc\n\n`;
    expect(parseSearchPickerOutput(stdout, 0)).toEqual({
      cancelled: false,
      resetToSections: true,
      innerKey: null,
    });
  });

  it("extracts the inner triple from the visible search line", () => {
    const sample: DisplayLine = {
      kind: "worktree",
      section: "worktree",
      name: "feature",
      shortPath: "../repo-feature",
      fullPath: "/abs/repo-feature",
      destination: "/abs/repo-feature",
      branch: "feature",
      prNumber: null,
    };
    const visibleLine = renderSearchLine(sample);
    const stdout = `feat\n\n${visibleLine}\n`;
    const outcome = parseSearchPickerOutput(stdout, 0);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.resetToSections).toBe(false);
    expect(outcome.innerKey).toBe(renderLine(sample));
    // sanity: the inner key contains the FIELD_SEP-joined triple
    expect(outcome.innerKey?.split(FIELD_SEP)).toHaveLength(3);
  });
});

describe("buildRenderLookup", () => {
  it("maps each rendered line back to its DisplayLine", () => {
    const a: DisplayLine = {
      kind: "worktree",
      section: "worktree",
      name: "a",
      shortPath: ".",
      fullPath: "/a",
      destination: "/a",
      branch: "",
      prNumber: null,
    };
    const b: DisplayLine = { ...a, name: "b", fullPath: "/b", destination: "/b" };
    const lookup = buildRenderLookup([a, b]);
    expect(lookup.get(renderLine(a))).toBe(a);
    expect(lookup.get(renderLine(b))).toBe(b);
  });
});
