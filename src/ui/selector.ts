import type { ConsoleIO } from "../io/console.js";
import type { DisplayLine, SectionKey } from "../types.js";
import { isFzfAvailable, runFzf as runFzfDefault, type FzfOptions, type FzfResult } from "./fzf.js";
import { FIELD_SEP, renderLine } from "./format.js";

export type FzfRunner = (options: FzfOptions) => Promise<FzfResult>;

const FILTER_ORDER: readonly Filter[] = ["all", "wt", "br", "pr"];
type Filter = "all" | "wt" | "br" | "pr";

const FOOTER = "↵ go   esc cancel   tab filter   ctrl-d delete   / commands   ? help";

const HELP_BODY = [
  "shortcuts",
  "  enter            go to highlighted entry",
  "  esc              cancel",
  "  tab / shift-tab  cycle filter (all / wt / br / pr)",
  "  ctrl-d           delete the highlighted worktree",
  "  /                slash commands",
  "  ?                this help",
  "",
  "slash commands",
  "  /new <branch>    create worktree from default branch and jump",
  "  /main            jump to the main worktree",
  "  /pr              load and filter pull requests",
  "  /refresh         reload worktrees / branches / PRs",
  "  /help            show this help",
];

export type SlashCommand =
  | { kind: "main" }
  | { kind: "pr" }
  | { kind: "refresh" }
  | { kind: "help" }
  | { kind: "new"; branch: string };

export type SelectOutcome =
  | { kind: "selected"; line: DisplayLine }
  | { kind: "slash"; command: SlashCommand }
  | { kind: "delete-target"; line: DisplayLine }
  | { kind: "cancelled" };

export interface SelectorOptions {
  console: ConsoleIO;
  /**
   * Override fzf detection. `true` forces fzf, `false` forces the numbered
   * fallback. Omit for auto-detect via PATH lookup.
   */
  useFzf?: boolean;
  /** Inject a custom runner for fzf. Defaults to spawning the real binary. */
  fzfRunner?: FzfRunner;
  /** Initial filter (used by `/pr` etc.). */
  initialFilter?: Filter;
  /** Prompt label override (e.g. "delete> "). */
  prompt?: string;
  /** Footer override. */
  footer?: string;
}

export async function selectInteractive(
  allLines: readonly DisplayLine[],
  options: SelectorOptions,
): Promise<SelectOutcome> {
  if (allLines.length === 0) return { kind: "cancelled" };

  const useFzf = options.useFzf ?? (await isFzfAvailable());
  options.console.debug(
    `selector mode=${useFzf ? "fzf" : "prompt"} totalLines=${allLines.length} initialFilter=${options.initialFilter ?? "all"}`,
  );

  if (useFzf) {
    return selectWithFzf(allLines, options);
  }
  return selectWithPrompt(allLines, options);
}

async function selectWithFzf(
  allLines: readonly DisplayLine[],
  options: SelectorOptions,
): Promise<SelectOutcome> {
  const runFzf = options.fzfRunner ?? runFzfDefault;
  let filter: Filter = options.initialFilter ?? "all";
  const prompt = options.prompt ?? "> ";
  const footer = options.footer ?? FOOTER;

  while (true) {
    const visible = applyFilter(allLines, filter);
    if (visible.length === 0) {
      filter = "all";
      continue;
    }
    const inputLines = visible.map((line) => renderLine(line));
    const lookup = new Map(visible.map((line) => [renderLine(line), line]));
    const header = filter === "all" ? "" : `filter: ${filter}`;
    const result = await runFzf({
      args: [
        `--prompt=${prompt}`,
        "--print-query",
        `--delimiter=${FIELD_SEP}`,
        "--nth=1",
        "--expect=tab,btab,?,ctrl-d",
        "--height=70%",
        "--reverse",
        "--layout=reverse",
        "--info=inline-right",
        "--header-first",
        `--header=${header}`,
        `--footer=${footer}`,
        "--preview",
        'if [ -n "{3}" ]; then printf "%s\\n" {3}; fi',
        "--preview-window=down:3:wrap",
      ],
      input: inputLines.join("\n"),
    });
    const outcome = parsePickerOutput(result.stdout, result.exitCode);
    options.console.debug(
      `fzf returned exit=${result.exitCode} key=${JSON.stringify(outcome.key)} query=${JSON.stringify(outcome.query)} selected=${outcome.selected ? "yes" : "no"}`,
    );
    if (outcome.cancelled) return { kind: "cancelled" };

    if (outcome.query.startsWith("/")) {
      const cmd = parseSlashCommand(outcome.query);
      if (cmd) return { kind: "slash", command: cmd };
      // Unknown slash command - reopen with the same query so the user sees it.
      continue;
    }

    if (outcome.key === "tab") {
      filter = nextFilter(filter, +1);
      options.console.debug(`tab: filter -> ${filter}`);
      continue;
    }
    if (outcome.key === "btab") {
      filter = nextFilter(filter, -1);
      options.console.debug(`shift-tab: filter -> ${filter}`);
      continue;
    }
    if (outcome.key === "?") {
      await runHelpOverlay(runFzf);
      continue;
    }
    if (outcome.key === "ctrl-d") {
      if (outcome.selected) {
        const line = lookup.get(outcome.selected);
        if (line) return { kind: "delete-target", line };
      }
      continue;
    }

    if (outcome.selected) {
      const line = lookup.get(outcome.selected);
      if (line) return { kind: "selected", line };
    }
    return { kind: "cancelled" };
  }
}

interface PickerOutput {
  cancelled: boolean;
  query: string;
  key: string;
  selected: string;
}

function parsePickerOutput(stdout: string, exitCode: number): PickerOutput {
  if (exitCode !== 0 && stdout === "") {
    return { cancelled: true, query: "", key: "", selected: "" };
  }
  const lines = stdout.replace(/\n$/, "").split("\n");
  return {
    cancelled: false,
    query: lines[0] ?? "",
    key: lines[1] ?? "",
    selected: lines[2] ?? "",
  };
}

function applyFilter(lines: readonly DisplayLine[], filter: Filter): DisplayLine[] {
  if (filter === "all") return [...lines];
  return lines.filter((l) => sectionMatches(l.section, filter));
}

function sectionMatches(section: SectionKey, filter: Filter): boolean {
  return section === filter;
}

function nextFilter(current: Filter, step: number): Filter {
  const idx = FILTER_ORDER.indexOf(current);
  const next = (idx + step + FILTER_ORDER.length) % FILTER_ORDER.length;
  return FILTER_ORDER[next]!;
}

export function parseSlashCommand(raw: string): SlashCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (head) {
    case "main":
    case "home":
      return { kind: "main" };
    case "pr":
      return { kind: "pr" };
    case "refresh":
    case "reload":
    case "r":
      return { kind: "refresh" };
    case "help":
    case "h":
    case "?":
      return { kind: "help" };
    case "new":
    case "n":
      if (arg === "") return { kind: "help" };
      return { kind: "new", branch: arg };
    default:
      return null;
  }
}

async function runHelpOverlay(runFzf: FzfRunner): Promise<void> {
  await runFzf({
    args: [
      "--prompt=help> ",
      "--height=70%",
      "--reverse",
      "--layout=reverse",
      "--info=hidden",
      "--header-first",
      "--header=press esc to close",
      "--no-sort",
      "--disabled",
    ],
    input: HELP_BODY.join("\n"),
  });
}

const MAX_PROMPT_RETRIES = 5;

async function selectWithPrompt(
  allLines: readonly DisplayLine[],
  options: SelectorOptions,
): Promise<SelectOutcome> {
  const console = options.console;
  let filter: Filter = options.initialFilter ?? "all";

  for (let attempt = 0; attempt < MAX_PROMPT_RETRIES; attempt++) {
    const visible = applyFilter(allLines, filter);
    if (visible.length === 0) {
      filter = "all";
      continue;
    }
    console.errln("");
    if (filter !== "all") console.errln(`(filter: ${filter})`);
    visible.forEach((line, idx) =>
      console.errln(
        `${String(idx + 1).padStart(2)}) ${renderLine(line).split(FIELD_SEP)[0] ?? line.name}`,
      ),
    );
    console.errln(
      "type number to go, d <number> to delete, /new <branch>, /main, /pr, /refresh, /help, blank to cancel",
    );
    const answer = await console.ask("> ");
    if (answer === null) return { kind: "cancelled" };
    const trimmed = answer.trim();
    if (trimmed === "") return { kind: "cancelled" };

    if (trimmed.startsWith("/")) {
      const cmd = parseSlashCommand(trimmed);
      if (cmd) return { kind: "slash", command: cmd };
      console.errln(`cdwt: unknown command: ${trimmed}`);
      continue;
    }

    if (trimmed === "tab") {
      filter = nextFilter(filter, +1);
      continue;
    }
    if (trimmed === "?") {
      console.errln(HELP_BODY.join("\n"));
      continue;
    }

    const deleteMatch = /^d\s+(\d+)$/i.exec(trimmed);
    if (deleteMatch) {
      const n = Number.parseInt(deleteMatch[1]!, 10);
      if (!Number.isFinite(n) || n < 1 || n > visible.length) {
        console.errln("cdwt: invalid selection");
        continue;
      }
      return { kind: "delete-target", line: visible[n - 1]! };
    }

    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > visible.length) {
      console.errln("cdwt: invalid selection");
      continue;
    }
    return { kind: "selected", line: visible[n - 1]! };
  }
  console.errln("cdwt: too many invalid attempts; aborting");
  return { kind: "cancelled" };
}
