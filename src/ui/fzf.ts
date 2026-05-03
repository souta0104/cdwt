import { spawn } from "node:child_process";
import { run } from "../io/exec.js";

export interface FzfOptions {
  args: string[];
  input: string;
}

export interface FzfResult {
  exitCode: number;
  stdout: string;
}

export async function isFzfAvailable(): Promise<boolean> {
  const result = await run("which", ["fzf"]);
  return result.exitCode === 0;
}

/**
 * Spawn fzf with stdout captured but stdin/stderr connected to the user's TTY,
 * so the picker can render to the terminal while we still receive the choice.
 */
export function runFzf({ args, input }: FzfOptions): Promise<FzfResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("fzf", args, {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout }));
    child.stdin.write(input);
    child.stdin.end();
  });
}
