import type { ConsoleIO } from "../io/console.js";
import type { DisplayLine, SectionKey } from "../types.js";
import { isFzfAvailable, runFzf as runFzfDefault, type FzfOptions, type FzfResult } from "./fzf.js";
import { FIELD_SEP, renderLine, renderSearchLine, sectionLabel } from "./format.js";
import {
  buildRenderLookup,
  parseItemPickerOutput,
  parseSearchPickerOutput,
  parseSectionPickerOutput,
} from "./fzf-parse.js";

export type FzfRunner = (options: FzfOptions) => Promise<FzfResult>;

const SECTION_ORDER: readonly SectionKey[] = [
  "root",
  "worktree",
  "new worktree",
  "delete worktree",
  "github pr",
  "local branch",
];

interface SectionSummary {
  key: SectionKey;
  label: string;
  lines: DisplayLine[];
}

export interface SelectorOptions {
  console: ConsoleIO;
  /**
   * Override the fzf detection. `true` forces fzf, `false` forces the
   * numbered prompt. Omit (or `undefined`) for auto-detect via PATH lookup.
   */
  useFzf?: boolean;
  /** Inject a custom runner for fzf. Defaults to spawning the real binary. */
  fzfRunner?: FzfRunner;
}

export async function selectInteractive(
  allLines: readonly DisplayLine[],
  options: SelectorOptions,
): Promise<DisplayLine | null> {
  const sections = summariseSections(allLines);
  if (sections.length === 0) return null;

  const useFzf = options.useFzf ?? (await isFzfAvailable());
  if (useFzf) {
    return selectWithFzf(allLines, sections, options.fzfRunner ?? runFzfDefault);
  }
  return selectWithPrompt(sections, options.console);
}

function summariseSections(lines: readonly DisplayLine[]): SectionSummary[] {
  const grouped = new Map<SectionKey, DisplayLine[]>();
  for (const line of lines) {
    const bucket = grouped.get(line.section);
    if (bucket) bucket.push(line);
    else grouped.set(line.section, [line]);
  }
  const summaries: SectionSummary[] = [];
  for (const key of SECTION_ORDER) {
    const list = grouped.get(key);
    if (!list || list.length === 0) continue;
    summaries.push({ key, label: sectionLabel(key, list.length), lines: list });
  }
  return summaries;
}

async function selectWithFzf(
  allLines: readonly DisplayLine[],
  sections: SectionSummary[],
  runFzf: FzfRunner,
): Promise<DisplayLine | null> {
  let sectionIndex: number | null = null;
  let pendingSearchQuery: string | null = null;
  const lookup = buildRenderLookup(allLines);

  while (true) {
    if (pendingSearchQuery !== null) {
      const outcome = await runSearchPicker(allLines, pendingSearchQuery, runFzf);
      if (outcome.cancelled) return null;
      if (outcome.resetToSections) {
        pendingSearchQuery = null;
        sectionIndex = null;
        continue;
      }
      const line = outcome.innerKey ? lookup.get(outcome.innerKey) : null;
      return line ?? null;
    }

    if (sectionIndex === null) {
      if (sections.length === 1) {
        sectionIndex = 0;
      } else {
        const choice = await runSectionPicker(sections, runFzf);
        if (choice.cancelled) return null;
        if (choice.searchQuery !== null) {
          pendingSearchQuery = choice.searchQuery;
          continue;
        }
        sectionIndex = choice.index;
      }
    }

    const summary = sections[sectionIndex]!;
    const itemLookup = buildRenderLookup(summary.lines);
    const outcome = await runItemPicker(summary, runFzf);
    if (outcome.cancelled) return null;
    if (outcome.action === "esc") {
      sectionIndex = null;
      continue;
    }
    if (outcome.action === "next") {
      sectionIndex = (sectionIndex + 1) % sections.length;
      continue;
    }
    if (outcome.action === "prev") {
      sectionIndex = (sectionIndex - 1 + sections.length) % sections.length;
      continue;
    }
    const line = outcome.selectedRendered ? itemLookup.get(outcome.selectedRendered) : null;
    return line ?? null;
  }
}

async function runSectionPicker(sections: SectionSummary[], runFzf: FzfRunner) {
  const input = sections.map((s) => s.label).join("\n");
  const result = await runFzf({
    args: [
      "--prompt=section> ",
      "--print-query",
      "--expect=esc",
      "--bind=change:accept",
      "--height=~20%",
      "--reverse",
      "--border",
      "--layout=reverse",
      "--info=inline-right",
      "--border-label= sections ",
      "--header=root / worktree / new worktree / delete worktree / github pr / local branch",
    ],
    input,
  });
  return parseSectionPickerOutput(
    result.stdout,
    result.exitCode,
    sections.map((s) => s.label),
  );
}

async function runItemPicker(summary: SectionSummary, runFzf: FzfRunner) {
  const inputLines = summary.lines.map((line) => renderLine(line));
  const { header, borderLabel, listHeight } = sectionPresentation(summary.key);
  const result = await runFzf({
    args: [
      "--prompt=cdwt> ",
      `--delimiter=${FIELD_SEP}`,
      "--nth=1",
      "--expect=esc,tab,btab",
      `--height=${listHeight}`,
      "--reverse",
      "--border",
      "--layout=reverse",
      "--info=inline-right",
      `--border-label=${borderLabel}`,
      "--preview-label= location ",
      "--preview-label-pos=2",
      `--header=${header}`,
      "--footer=esc: sections  tab: next  shift-tab: prev",
      "--preview",
      'if [ -n "{3}" ]; then printf "location: %s\\n" {3}; fi',
      "--preview-window=down:3:wrap",
    ],
    input: inputLines.join("\n"),
  });
  return parseItemPickerOutput(result.stdout, result.exitCode);
}

async function runSearchPicker(
  allLines: readonly DisplayLine[],
  initialQuery: string,
  runFzf: FzfRunner,
) {
  const inputLines = allLines.map((line) => renderSearchLine(line));
  const result = await runFzf({
    args: [
      `--query=${initialQuery}`,
      "--print-query",
      "--prompt=search> ",
      `--delimiter=${FIELD_SEP}`,
      "--with-nth=1",
      "--nth=1",
      "--expect=esc",
      "--height=70%",
      "--reverse",
      "--border",
      "--layout=reverse",
      "--info=inline-right",
      "--border-label= search ",
      "--preview-label= location ",
      "--preview-label-pos=2",
      "--header=all sections",
      "--footer=esc: sections",
      "--preview",
      'if [ -n "{3}" ]; then printf "location: %s\\n" {3}; fi',
      "--preview-window=down:4:wrap",
    ],
    input: inputLines.join("\n"),
  });
  return parseSearchPickerOutput(result.stdout, result.exitCode);
}

interface SectionPresentation {
  header: string;
  borderLabel: string;
  listHeight: string;
}

function sectionPresentation(key: SectionKey): SectionPresentation {
  switch (key) {
    case "root":
      return { header: "main repository", borderLabel: " root ", listHeight: "~20%" };
    case "worktree":
      return { header: "existing worktrees", borderLabel: " worktree ", listHeight: "60%" };
    case "new worktree":
      return {
        header: "create a branch and worktree from the default branch",
        borderLabel: " new worktree ",
        listHeight: "~20%",
      };
    case "delete worktree":
      return {
        header: "delete an existing worktree",
        borderLabel: " delete worktree ",
        listHeight: "60%",
      };
    case "github pr":
      return { header: "open pull requests", borderLabel: " github pr ", listHeight: "60%" };
    case "local branch":
      return {
        header: "local branches without worktree",
        borderLabel: " local branch ",
        listHeight: "60%",
      };
  }
}

const MAX_PROMPT_RETRIES = 5;

async function selectWithPrompt(
  sections: SectionSummary[],
  console: ConsoleIO,
): Promise<DisplayLine | null> {
  // Skip the section step entirely when there's only one section, mirroring
  // the fzf path. The user otherwise has to type "1" with no useful choice.
  let chosen: SectionSummary | null = sections.length === 1 ? sections[0]! : null;

  for (let attempt = 0; chosen === null && attempt < MAX_PROMPT_RETRIES; attempt++) {
    console.errln("Sections:");
    sections.forEach((s, idx) => console.errln(`${String(idx + 1).padStart(2)}) ${s.label}`));
    const answer = await console.ask("Select a section: ");
    if (answer === null) return null;
    const trimmed = answer.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > sections.length) {
      console.errln("cdwt: invalid selection");
      continue;
    }
    chosen = sections[n - 1]!;
  }
  if (chosen === null) {
    console.errln("cdwt: too many invalid section attempts; aborting");
    return null;
  }

  for (let attempt = 0; attempt < MAX_PROMPT_RETRIES; attempt++) {
    console.errln("");
    console.errln(chosen.key);
    chosen.lines.forEach((line, idx) =>
      console.errln(`${String(idx + 1).padStart(2)}) ${line.name}`),
    );
    const answer = await console.ask("Select a destination: ");
    if (answer === null) return null;
    const trimmed = answer.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > chosen.lines.length) {
      console.errln("cdwt: invalid selection");
      continue;
    }
    return chosen.lines[n - 1]!;
  }
  console.errln("cdwt: too many invalid destination attempts; aborting");
  return null;
}
