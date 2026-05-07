import type { DisplayLine, SectionKey } from "../types.js";

export const FIELD_SEP = "\x1f";
const TAG_WIDTH = 7;
const NAME_WIDTH = 44;

/**
 * Render a display line as `[tag] name<FS>shortPath<FS>fullPath`.
 * The tag goes into the visible column so users can filter by typing
 * `wt`, `br`, `pr`, or `main`. fzf's `--nth=1` covers the whole left side.
 */
export function renderLine(line: DisplayLine): string {
  const tag = pad(`[${line.section}]`, TAG_WIDTH);
  const paddedName = pad(line.name, NAME_WIDTH);
  return `${tag} ${paddedName}${FIELD_SEP}${line.shortPath}${FIELD_SEP}${line.fullPath}`;
}

export function tagOf(section: SectionKey): string {
  return `[${section}]`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
