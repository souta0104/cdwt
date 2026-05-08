import type { DisplayLine, SectionKey } from "../types.js";

export const FIELD_SEP = "\x1f";
const TAG_WIDTH = 11;
const NAME_WIDTH = 44;

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const FG_GREEN = `${ESC}32m`;
const FG_YELLOW = `${ESC}33m`;
const FG_CYAN = `${ESC}36m`;
const FG_MAGENTA = `${ESC}35m`;
const FG_GRAY = `${ESC}90m`;

interface SectionStyle {
  /** Human-readable label shown in brackets, e.g. `[worktree]`. */
  label: string;
  /** Single-cell glyph that hints at the row's "kind". */
  glyph: string;
  /** ANSI sequence applied to glyph + tag + name. */
  color: string;
}

/**
 * Visual identity per section.
 *  - main / worktree: the worktree exists; enter = jump.
 *      Filled glyph + vivid color.
 *  - branch / PR:     the worktree does NOT exist yet; enter = create.
 *      Open glyph and a softer color so it contrasts with worktrees.
 */
const STYLES: Record<SectionKey, SectionStyle> = {
  main: { label: "main", glyph: "★", color: `${BOLD}${FG_GREEN}` },
  wt: { label: "worktree", glyph: "●", color: FG_CYAN },
  br: { label: "branch", glyph: "○", color: FG_YELLOW },
  pr: { label: "PR", glyph: "◆", color: FG_MAGENTA },
};

/**
 * Render a display line as
 * `<glyph> [label] name <dim shortPath><FS>shortPath<FS>fullPath`.
 *
 * Field 1 is the visible row. Field 2 carries the short path so fzf's
 * preview window can pull it; field 3 carries the absolute path used for
 * the final `cd` target.
 *
 * fzf is invoked with `--with-nth=1` so only field 1 is rendered, and
 * with `--nth=1` so matching is restricted to that field. Section labels
 * (e.g. `[worktree]`) appear as literal text so users can fzf-filter by
 * typing `worktree`, `branch`, `pr`, etc.
 */
export function renderLine(line: DisplayLine): string {
  const style = STYLES[line.section];
  const tag = pad(`[${style.label}]`, TAG_WIDTH);
  const paddedName = pad(line.name, NAME_WIDTH);
  const head = `${style.color}${style.glyph} ${tag} ${paddedName}${RESET}`;
  const pathHint = `${FG_GRAY}${line.shortPath}${RESET}`;
  const visible = `${head} ${pathHint}`;
  return `${visible}${FIELD_SEP}${line.shortPath}${FIELD_SEP}${line.fullPath}`;
}

export function sectionLabel(section: SectionKey): string {
  return STYLES[section].label;
}

export function tagOf(section: SectionKey): string {
  return `[${STYLES[section].label}]`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
