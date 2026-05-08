import type { ConsoleIO } from "../io/console.js";

/**
 * Surface that slash-command executors call into. select.ts implements this
 * over its mutable state. Adding a new command that needs novel behaviour =
 * extend this interface and provide the implementation in select.ts.
 */
export interface CommandHost {
  console: ConsoleIO;
  /** Print the main worktree path on stdout (jumps via the zsh wrapper). */
  printMainDestination(): void;
  /**
   * Run the create-new-worktree action. Returns the exit code that should
   * propagate out of `runSelect` (0 on success, EXIT_CANCELLED on abort, ...).
   */
  createNewWorktree(branch: string | undefined): Promise<number>;
  /** Load PRs via `gh` and rebuild the picker rows. */
  loadPrs(): Promise<void>;
  /** Reload worktrees, branches, and (if already loaded) PRs. */
  refresh(): Promise<void>;
}

export type CommandResult =
  | { kind: "exit"; code: number }
  | { kind: "continue" };

export interface SlashCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  /**
   * Hint shown next to the command in the palette / help text. e.g.
   * `<branch>` for `/new <branch>`. Omit for commands that take no arg.
   */
  argHint?: string;
  execute(rawArgs: string, host: CommandHost): Promise<CommandResult>;
}

const NEW_CMD: SlashCommand = {
  name: "new",
  aliases: ["n"],
  description: "create a worktree from the default branch",
  argHint: "<branch>",
  async execute(rawArgs, host) {
    const branch = rawArgs.trim() === "" ? undefined : rawArgs.trim();
    const code = await host.createNewWorktree(branch);
    return { kind: "exit", code };
  },
};

const MAIN_CMD: SlashCommand = {
  name: "main",
  aliases: ["home"],
  description: "jump to the main worktree",
  execute(_rawArgs, host) {
    host.printMainDestination();
    return Promise.resolve({ kind: "exit", code: 0 });
  },
};

const PR_CMD: SlashCommand = {
  name: "pr",
  aliases: [],
  description: "load and filter pull requests",
  async execute(_rawArgs, host) {
    await host.loadPrs();
    return { kind: "continue" };
  },
};

const REFRESH_CMD: SlashCommand = {
  name: "refresh",
  aliases: ["reload", "r"],
  description: "reload worktrees, branches, and PRs",
  async execute(_rawArgs, host) {
    await host.refresh();
    return { kind: "continue" };
  },
};

const HELP_CMD: SlashCommand = {
  name: "help",
  aliases: ["h", "?"],
  description: "show command help",
  execute(_rawArgs, host) {
    host.console.errln(buildHelpText(SLASH_COMMANDS));
    return Promise.resolve({ kind: "continue" });
  },
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  NEW_CMD,
  MAIN_CMD,
  PR_CMD,
  REFRESH_CMD,
  HELP_CMD,
];

export function findCommand(name: string): SlashCommand | null {
  if (name === "") return null;
  return (
    SLASH_COMMANDS.find((c) => c.name === name || c.aliases.includes(name)) ?? null
  );
}

export interface ParsedCommandLine {
  command: SlashCommand;
  args: string;
}

/**
 * Parse a raw line typed by the user (with or without leading slash). Returns
 * null when the input isn't a slash command or the command name is unknown.
 */
export function parseCommandLine(input: string): ParsedCommandLine | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1).trim();
  if (body === "") return null;
  const [head, ...rest] = body.split(/\s+/);
  if (head === undefined || head === "") return null;
  const command = findCommand(head);
  if (!command) return null;
  return { command, args: rest.join(" ") };
}

export function buildHelpText(commands: readonly SlashCommand[]): string {
  const rows = commands.map((cmd) => {
    const aliases = cmd.aliases.map((a) => `/${a}`).join(", ");
    const left = `/${cmd.name}${cmd.argHint ? ` ${cmd.argHint}` : ""}`;
    const aliasPart = aliases ? `  (${aliases})` : "";
    return `  ${left.padEnd(20)} ${cmd.description}${aliasPart}`;
  });
  return ["slash commands", ...rows].join("\n");
}
