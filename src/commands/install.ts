import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import pc from "picocolors";
import { appendLineIfMissing } from "../core/rc-file.js";
import type { ConsoleIO } from "../io/console.js";

const SHELL_FILE = "cdwt.zsh";
const SHELL_FUNCTION = `cdwt() {
  local destination
  case "\${1-}" in
    -h|--help)
      command cdwt "$@"
      return $?
      ;;
  esac
  if ! destination="$(command cdwt "$@")"; then
    return $?
  fi
  if [[ -z "$destination" ]]; then
    return 1
  fi
  cd "$destination" || return $?
}
`;

const RC_LINE = 'source "$HOME/.local/share/cdwt/cdwt.zsh"';

export interface InstallOptions {
  home: string;
  rcFile?: string | undefined;
  console: ConsoleIO;
}

export async function runInstall(options: InstallOptions): Promise<number> {
  const { console } = options;
  const shareDir = path.join(options.home, ".local", "share", "cdwt");
  const shellFile = path.join(shareDir, SHELL_FILE);
  await mkdir(shareDir, { recursive: true });
  await writeFile(shellFile, SHELL_FUNCTION, { mode: 0o644 });

  const rcFile = options.rcFile ?? path.join(options.home, ".zshrc");
  const existing = (await fileExists(rcFile)) ? await readFile(rcFile, "utf8") : "";
  const result = appendLineIfMissing(existing, RC_LINE);
  if (result.changed) {
    await writeFile(rcFile, result.contents);
  }

  console.outln(`${pc.green("✓")} installed shell wrapper to ${shellFile}`);
  console.outln(
    `${pc.green("✓")} ${result.changed ? "added" : "kept"} \`source\` line in ${rcFile}`,
  );
  console.outln("");
  console.outln("Reload your shell with one of:");
  console.outln(`  exec zsh -l`);
  console.outln(`  source "${rcFile}"`);
  return 0;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

export function defaultHome(): string {
  return process.env["HOME"] ?? homedir();
}
