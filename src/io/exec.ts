import { spawn, type SpawnOptions } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /**
   * When true, child stdio inherits the parent's terminal (for git worktree, gh checkout, ...).
   * The child's stdout is redirected to the parent's stderr so the wrapper's
   * `destination=$(cdwt-select)` capture stays clean — git writes "HEAD is now at ..." to
   * stdout and would otherwise pollute the destination path. The user still sees the
   * message because parent stderr is the terminal.
   */
  inheritStdio?: boolean;
  /** Optional input to write on stdin. */
  input?: string;
  /**
   * When provided, called with a timing message after the child exits.
   * Receives: command args, exit code, wall time, stdout/stderr byte counts.
   */
  onDebug?: (msg: string) => void;
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
    const t0 = Date.now();
    const stdio: SpawnOptions["stdio"] = options.inheritStdio
      ? ["inherit", process.stderr, "inherit"]
      : ["pipe", "pipe", "pipe"];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio,
    });

    if (options.inheritStdio) {
      child.on("error", reject);
      child.on("close", (exitCode) => {
        const code = exitCode ?? 0;
        const elapsed = Date.now() - t0;
        options.onDebug?.(
          `exec [inherited] ${command} ${args.join(" ")} cwd=${options.cwd ?? "."} exit=${code} +${elapsed}ms`,
        );
        resolve({ stdout: "", stderr: "", exitCode: code });
      });
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
    child.on("close", (exitCode) => {
      const code = exitCode ?? 0;
      const elapsed = Date.now() - t0;
      options.onDebug?.(
        `exec ${command} ${args.join(" ")} cwd=${options.cwd ?? "."} exit=${code} stdout=${stdout.length}B stderr=${stderr.length}B +${elapsed}ms`,
      );
      resolve({ stdout, stderr, exitCode: code });
    });

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }
  });
}
