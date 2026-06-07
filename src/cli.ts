import { Command } from "commander";
import pc from "picocolors";
import { CdwtError } from "./errors.js";
import { runInstall, defaultHome as installHome } from "./commands/install.js";
import { runSelect, defaultHome as selectHome } from "./commands/select.js";
import { createDefaultConsole, type ConsoleIO } from "./io/console.js";

interface GlobalFlags {
  verbose?: boolean;
}

interface SelectFlags extends GlobalFlags {
  pr?: boolean | string;
  config?: string;
}

interface InstallFlags extends GlobalFlags {
  rc?: string;
}

interface NewFlags extends GlobalFlags {
  config?: string;
}

/**
 * Build the commander program. Exit codes flow back through `state.exitCode`
 * so the entry point can call `process.exit` exactly once. Keeping that out
 * of `runSelect` / `runInstall` keeps them testable from unit tests.
 */
export function buildProgram(consoleFactory: (verbose: boolean) => ConsoleIO): {
  program: Command;
  state: { exitCode: number };
} {
  const program = new Command();
  const state = { exitCode: 0 };

  program
    .name("cdwt")
    .description(
      "Interactive git worktree switcher. Prints the destination path on stdout; " +
        "use the bundled zsh wrapper (installed via `cdwt install`) so the " +
        "shell can `cd` into it.",
    )
    .version("0.1.0")
    .option("-v, --verbose", "write timestamped diagnostic logs to stderr");

  program
    .option(
      "--pr [number]",
      "with a number, cd directly into that PR's worktree (creating it if needed); " +
        "without a number, open the picker pre-filtered to PRs",
    )
    .option(
      "--config <file>",
      "use only the given settings file (overrides .cdwt/settings.json discovery)",
    )
    .action(async (opts: SelectFlags) => {
      const verbose = Boolean(opts.verbose ?? program.opts<GlobalFlags>().verbose);
      const console = consoleFactory(verbose);
      const prNumber = parsePrNumber(opts.pr);
      state.exitCode = await runSelect({
        defaultBranchOnly: false,
        prFilter: opts.pr === true,
        ...(prNumber !== undefined ? { prNumber } : {}),
        cwd: process.cwd(),
        configOverride: opts.config ?? process.env["CDWT_CONFIG"],
        home: selectHome(),
        console,
      });
    });

  program
    .command("root")
    .description("print the path of the default branch worktree and exit")
    .action(async () => {
      const verbose = Boolean(program.opts<GlobalFlags>().verbose);
      const console = consoleFactory(verbose);
      state.exitCode = await runSelect({
        defaultBranchOnly: true,
        cwd: process.cwd(),
        configOverride: process.env["CDWT_CONFIG"],
        home: selectHome(),
        console,
      });
    });

  program
    .command("new")
    .description("create a new worktree from the default branch and cd into it")
    .argument("[branch]", "branch name (prompts when omitted)")
    .option(
      "--config <file>",
      "use only the given settings file (overrides .cdwt/settings.json discovery)",
    )
    .action(async (branch: string | undefined, opts: NewFlags) => {
      const verbose = Boolean(opts.verbose ?? program.opts<GlobalFlags>().verbose);
      const console = consoleFactory(verbose);
      state.exitCode = await runSelect({
        defaultBranchOnly: false,
        newBranch: branch ?? true,
        cwd: process.cwd(),
        configOverride: opts.config ?? process.env["CDWT_CONFIG"],
        home: selectHome(),
        console,
      });
    });

  program
    .command("install")
    .description("install the zsh shell wrapper to ~/.local/share/cdwt and update ~/.zshrc")
    .option("--rc <file>", "rc file to update (default: $HOME/.zshrc)")
    .action(async (opts: InstallFlags) => {
      const verbose = Boolean(opts.verbose ?? program.opts<GlobalFlags>().verbose);
      const console = consoleFactory(verbose);
      state.exitCode = await runInstall({
        home: installHome(),
        rcFile: opts.rc,
        console,
      });
    });

  return { program, state };
}

/**
 * Resolve the `--pr` value into a PR number. `true` (flag without value) and
 * `undefined` mean "no direct PR jump". A string must be a positive integer.
 */
function parsePrNumber(pr: boolean | string | undefined): number | undefined {
  if (typeof pr !== "string") return undefined;
  if (!/^\d+$/.test(pr)) {
    throw new CdwtError(`invalid PR number: ${pr}`);
  }
  return Number.parseInt(pr, 10);
}

async function main(): Promise<number> {
  const { program, state } = buildProgram((verbose) => createDefaultConsole({ verbose }));
  // We need a console for error reporting before parsing; use non-verbose default.
  const errorConsole = createDefaultConsole();
  try {
    await program.parseAsync(process.argv);
    return state.exitCode;
  } catch (error) {
    if (error instanceof CdwtError) {
      errorConsole.errln(`${pc.red("cdwt:")} ${error.message}`);
      return error.code;
    }
    errorConsole.errln(`${pc.red("cdwt:")} ${(error as Error).message}`);
    return 1;
  }
}

const exitCode = await main();
process.exit(exitCode);
