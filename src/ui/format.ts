import type { DisplayLine, SectionKey } from "../types.js";

export const FIELD_SEP = "\x1f";
const NAME_WIDTH = 44;
const SECTION_WIDTH = 12;

/**
 * Render a display line into the `name<FS>shortPath<FS>fullPath` triple
 * the bash version pipes into fzf, with the same fixed-width name padding
 * so columns line up.
 */
export function renderLine(line: DisplayLine): string {
  const paddedName = pad(line.name, NAME_WIDTH);
  return `${paddedName}${FIELD_SEP}${line.shortPath}${FIELD_SEP}${line.fullPath}`;
}

/**
 * Render a search-mode line that includes the section badge. The first column
 * is the human-visible row, the second is the original line (so we can
 * recover the destination from the selection), and the third is the full
 * path for the preview window.
 */
export function renderSearchLine(line: DisplayLine): string {
  const sectionBadge = pad(`[${line.section}]`, SECTION_WIDTH);
  const visible = `${sectionBadge}  ${pad(line.name, NAME_WIDTH)}  ${line.shortPath}`;
  const inner = renderLine(line);
  return `${visible}${FIELD_SEP}${inner}${FIELD_SEP}${line.fullPath}`;
}

export function sectionLabel(section: SectionKey, count: number): string {
  return `${section} (${count})`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
