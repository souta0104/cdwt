import { spawn, type SpawnOptions } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** When true, child stdio inherits the parent's terminal (for fzf, gh checkout, ...). */
  inheritStdio?: boolean;
  /** Optional input to write on stdin. */
  input?: string;
}

/**
 * Spawn a process and capture stdout/stderr.
 * Never throws on a non-zero exit; the caller decides what to do with `exitCode`.
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const stdio: SpawnOptions["stdio"] = options.inheritStdio
      ? "inherit"
      : ["pipe", "pipe", "pipe"];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio,
    });

    if (options.inheritStdio) {
      child.on("error", reject);
      child.on("close", (exitCode) => resolve({ stdout: "", stderr: "", exitCode: exitCode ?? 0 }));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 0 }));

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }
  });
}
