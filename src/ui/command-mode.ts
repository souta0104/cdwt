import {
  buildHelpText,
  parseCommandLine,
  type SlashCommand,
} from "../commands/slash-commands.js";
import type { ConsoleIO } from "../io/console.js";
import {
  isFzfAvailable,
  runFzf as runFzfDefault,
  type FzfOptions,
  type FzfResult,
} from "./fzf.js";
import { FIELD_SEP } from "./format.js";

export type FzfRunner = (options: FzfOptions) => Promise<FzfResult>;

export type CommandModeOutcome =
  | { kind: "command"; command: SlashCommand; args: string }
  | { kind: "cancelled" };

export interface CommandModeOptions {
  console: ConsoleIO;
  registry: readonly SlashCommand[];
  useFzf?: boolean;
  fzfRunner?: FzfRunner;
  /**
   * If set, parsed first as a `/<name> [args]` line. On a hit, the command is
   * returned without showing the palette. This lets the picker pass through
   * full lines typed in the numbered fallback (e.g. `/main`, `/new feat/x`).
   */
  initialInput?: string;
}

const PROMPT = "cmd> ";

/**
 * Read-eval-loop for slash commands.
 *
 * fzf path: a palette of available commands. fzf is the discovery surface;
 * picking an entry that has an `argHint` triggers a follow-up `console.ask`.
 *
 * Prompt fallback: a numbered list. Either type the number, or type the
 * full `/<name> [args]` line directly.
 */
export async function runCommandMode(
  options: CommandModeOptions,
): Promise<CommandModeOutcome> {
  if (options.initialInput !== undefined) {
    const parsed = parseCommandLine(options.initialInput);
    if (parsed) {
      return resolveArgs(parsed.command, parsed.args, options);
    }
    options.console.errln(`cdwt: unknown command: ${options.initialInput.trim()}`);
  }

  const useFzf = options.useFzf ?? (await isFzfAvailable());
  if (useFzf) return runWithFzf(options);
  return runWithPrompt(options);
}

const MAX_PROMPT_RETRIES = 5;

async function runWithPrompt(options: CommandModeOptions): Promise<CommandModeOutcome> {
  const { console, registry } = options;

  for (let attempt = 0; attempt < MAX_PROMPT_RETRIES; attempt++) {
    console.errln("");
    registry.forEach((cmd, idx) => console.errln(formatPaletteRow(cmd, idx + 1)));
    console.errln(
      "type number to pick, /<name> [args] to dispatch directly, blank to cancel",
    );
    const answer = await console.ask(PROMPT);
    if (answer === null) return { kind: "cancelled" };
    const trimmed = answer.trim();
    if (trimmed === "") return { kind: "cancelled" };

    if (trimmed.startsWith("/")) {
      const parsed = parseCommandLine(trimmed);
      if (parsed) return resolveArgs(parsed.command, parsed.args, options);
      console.errln(`cdwt: unknown command: ${trimmed}`);
      continue;
    }

    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > registry.length) {
      console.errln("cdwt: invalid selection");
      continue;
    }
    const command = registry[n - 1]!;
    return resolveArgs(command, "", options);
  }
  console.errln("cdwt: too many invalid attempts; aborting");
  return { kind: "cancelled" };
}

async function runWithFzf(options: CommandModeOptions): Promise<CommandModeOutcome> {
  const runFzf = options.fzfRunner ?? runFzfDefault;
  const { registry, console } = options;

  const inputLines = registry.map((cmd) => renderPaletteLine(cmd));
  const lookup = new Map(inputLines.map((line, idx) => [line, registry[idx]!]));

  const result = await runFzf({
    args: [
      `--prompt=${PROMPT}`,
      "--print-query",
      `--delimiter=${FIELD_SEP}`,
      "--nth=1",
      "--height=40%",
      "--reverse",
      "--layout=reverse",
      "--info=inline-right",
      "--header=pick a command",
    ],
    input: inputLines.join("\n"),
  });

  if (result.exitCode !== 0 && result.stdout === "") {
    return { kind: "cancelled" };
  }

  const lines = result.stdout.replace(/\n$/, "").split("\n");
  const query = lines[0] ?? "";
  const selected = lines[1] ?? "";

  // If user typed a freeform `/<name> [args]` query, dispatch on Enter.
  if (query.startsWith("/")) {
    const parsed = parseCommandLine(query);
    if (parsed) return resolveArgs(parsed.command, parsed.args, options);
    console.errln(`cdwt: unknown command: ${query.trim()}`);
    return { kind: "cancelled" };
  }

  const command = selected ? lookup.get(selected) : undefined;
  if (!command) return { kind: "cancelled" };
  return resolveArgs(command, "", options);
}

async function resolveArgs(
  command: SlashCommand,
  rawArgs: string,
  options: CommandModeOptions,
): Promise<CommandModeOutcome> {
  if (command.argHint && rawArgs.trim() === "") {
    const answer = await options.console.ask(`/${command.name} ${command.argHint}> `);
    if (answer === null || answer.trim() === "") return { kind: "cancelled" };
    return { kind: "command", command, args: answer.trim() };
  }
  return { kind: "command", command, args: rawArgs };
}

function renderPaletteLine(cmd: SlashCommand): string {
  const left = `/${cmd.name}${cmd.argHint ? ` ${cmd.argHint}` : ""}`;
  return `${left.padEnd(20)}${FIELD_SEP}${cmd.description}`;
}

function formatPaletteRow(cmd: SlashCommand, n: number): string {
  const left = `/${cmd.name}${cmd.argHint ? ` ${cmd.argHint}` : ""}`;
  return `${String(n).padStart(2)}) ${left.padEnd(20)} ${cmd.description}`;
}

// Used in tests to assert help can be derived from the registry.
export { buildHelpText };
