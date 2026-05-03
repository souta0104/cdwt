import type { DisplayLine } from "../types.js";
import { FIELD_SEP, renderLine } from "./format.js";

export interface SectionPickerOutcome {
  cancelled: boolean;
  searchQuery: string | null;
  /** Index into the section list. -1 when not applicable (cancelled / search). */
  index: number;
}

export interface ItemPickerOutcome {
  cancelled: boolean;
  action: "esc" | "next" | "prev" | "select";
  selectedRendered: string | null;
}

export interface SearchPickerOutcome {
  cancelled: boolean;
  resetToSections: boolean;
  /** Inner `name<FS>shortPath<FS>fullPath` triple to look up in a renderLine map. */
  innerKey: string | null;
}

/**
 * Parse the stdout of an `fzf --print-query --expect=esc` invocation that
 * accepts on `change` (so the section picker can hand off to a search query).
 */
export function parseSectionPickerOutput(
  stdout: string,
  exitCode: number,
  sectionLabels: readonly string[],
): SectionPickerOutcome {
  if (exitCode !== 0 && stdout === "") {
    return { cancelled: true, searchQuery: null, index: -1 };
  }
  const lines = stdout.replace(/\n$/, "").split("\n");
  const query = lines[0] ?? "";
  const key = lines.length > 1 ? lines[1]! : "";
  const selectedLabel = lines.length > 2 ? lines[2]! : "";

  if (key === "esc") return { cancelled: true, searchQuery: null, index: -1 };
  if (query !== "") return { cancelled: false, searchQuery: query, index: -1 };
  const idx = sectionLabels.findIndex((label) => label === selectedLabel);
  if (idx === -1) return { cancelled: true, searchQuery: null, index: -1 };
  return { cancelled: false, searchQuery: null, index: idx };
}

/**
 * Parse the stdout of an `fzf --expect=esc,tab,btab` invocation used inside
 * an individual section.
 */
export function parseItemPickerOutput(stdout: string, exitCode: number): ItemPickerOutcome {
  if (exitCode !== 0 && stdout === "") {
    return { cancelled: true, action: "select", selectedRendered: null };
  }
  const lines = stdout.replace(/\n$/, "").split("\n");
  const key = lines[0] ?? "";
  const selected = lines.length > 1 ? lines[1]! : "";

  if (key === "esc") return { cancelled: false, action: "esc", selectedRendered: null };
  if (key === "tab") return { cancelled: false, action: "next", selectedRendered: null };
  if (key === "btab") return { cancelled: false, action: "prev", selectedRendered: null };
  if (selected === "") return { cancelled: true, action: "select", selectedRendered: null };
  return { cancelled: false, action: "select", selectedRendered: selected };
}

/**
 * Parse the stdout of the cross-section search picker. The selected line has
 * the shape `visible<FS>name<FS>shortPath<FS>fullPath<FS>fullPath` and we
 * pluck the inner `name<FS>shortPath<FS>fullPath` triple so the caller can
 * look up the original DisplayLine via a renderLine() map.
 */
export function parseSearchPickerOutput(stdout: string, exitCode: number): SearchPickerOutcome {
  if (exitCode !== 0 && stdout === "") {
    return { cancelled: true, resetToSections: false, innerKey: null };
  }
  const lines = stdout.replace(/\n$/, "").split("\n");
  const query = lines[0] ?? "";
  const key = lines.length > 1 ? lines[1]! : "";
  const selectedSearchLine = lines.length > 2 ? lines[2]! : "";

  if (query === "") return { cancelled: false, resetToSections: true, innerKey: null };
  if (key === "esc") return { cancelled: false, resetToSections: true, innerKey: null };
  if (selectedSearchLine === "") {
    return { cancelled: true, resetToSections: false, innerKey: null };
  }
  const parts = selectedSearchLine.split(FIELD_SEP);
  if (parts.length < 4) return { cancelled: true, resetToSections: false, innerKey: null };
  return {
    cancelled: false,
    resetToSections: false,
    innerKey: `${parts[1]}${FIELD_SEP}${parts[2]}${FIELD_SEP}${parts[3]}`,
  };
}

/** Build a `renderLine(line) → line` lookup table. Used in selector and tests. */
export function buildRenderLookup(lines: readonly DisplayLine[]): Map<string, DisplayLine> {
  const lookup = new Map<string, DisplayLine>();
  for (const line of lines) {
    lookup.set(renderLine(line), line);
  }
  return lookup;
}
