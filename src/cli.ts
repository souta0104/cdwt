import { Command } from "commander";
import pc from "picocolors";
import { CdwtError } from "./errors.js";
import { runInstall, defaultHome as installHome } from "./commands/install.js";
import { runSelect, defaultHome as selectHome } from "./commands/select.js";
import { createDefaultConsole, type ConsoleIO } from "./io/console.js";

interface SelectFlags {
  defaultBranch?: boolean;
  config?: string;
}

interface InstallFlags {
  rc?: string;
}

/**
 * Build the commander program. Exit codes flow back through `state.exitCode`
 * so the entry point can call `process.exit` exactly once. Keeping that out
 * of `runSelect` / `runInstall` keeps them testable from unit tests.
 */
export function buildProgram(console: ConsoleIO): {
  program: Command;
  state: { exitCode: number };
} {
  const program = new Command();
  const state = { exitCode: 0 };

  program
    .name("cdwt-select")
    .description(
      "Interactive git worktree switcher. Prints the destination path on stdout; " +
        "use the bundled zsh wrapper (installed via `cdwt-select install`) so the " +
        "shell can `cd` into it.",
    )
    .version("0.1.0");

  program
    .option("--default-branch", "print the path of the default branch worktree and exit")
    .option(
      "--config <file>",
      "use only the given settings file (overrides .cdwt/settings.json discovery)",
    )
    .action(async (opts: SelectFlags) => {
      state.exitCode = await runSelect({
        defaultBranchOnly: Boolean(opts.defaultBranch),
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
      state.exitCode = await runInstall({
        home: installHome(),
        rcFile: opts.rc,
        console,
      });
    });

  return { program, state };
}

async function main(): Promise<number> {
  const console = createDefaultConsole();
  const { program, state } = buildProgram(console);
  try {
    await program.parseAsync(process.argv);
    return state.exitCode;
  } catch (error) {
    if (error instanceof CdwtError) {
      console.errln(`${pc.red("cdwt:")} ${error.message}`);
      return error.code;
    }
    console.errln(`${pc.red("cdwt:")} ${(error as Error).message}`);
    return 1;
  }
}

const exitCode = await main();
process.exit(exitCode);
