import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSelect } from "../src/commands/select.js";
import { TestConsole } from "../src/io/test-console.js";

let workdir: string;
let repoDir: string;
let home: string;

beforeEach(async () => {
  workdir = await realpath(await mkdtemp(path.join(tmpdir(), "cdwt-select-")));
  repoDir = path.join(workdir, "repo");
  home = path.join(workdir, "home");
  await mkdir(repoDir, { recursive: true });
  await mkdir(home, { recursive: true });
  exec(repoDir, "git", ["init", "-q", "-b", "main"]);
  exec(repoDir, "git", ["config", "user.email", "test@example.com"]);
  exec(repoDir, "git", ["config", "user.name", "Test"]);
  exec(repoDir, "git", ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repoDir, "README.md"), "# repo\n");
  exec(repoDir, "git", ["add", "."]);
  exec(repoDir, "git", ["commit", "-q", "-m", "init"]);
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const PROMPT_SELECTOR = { useFzf: false } as const;

describe("runSelect --default-branch", () => {
  it("prints the main worktree and exits 0 without prompting", async () => {
    const console = new TestConsole();
    const code = await runSelect({
      defaultBranchOnly: true,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
    });
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(repoDir);
    expect(console.askedPrompts).toEqual([]);
  });
});

/**
 * Helper to determine which section number "delete worktree" is in the prompt
 * by inspecting the stderr output after the selector renders sections.
 *
 * Drives select via a custom fzfRunner that returns the section label matching
 * "delete worktree" on first call, then the item on second call.
 */
describe("runSelect delete loop", () => {
  /**
   * Build a fake FzfRunner queue: each call pops and returns the next fake result.
   * Each entry is { stdout, exitCode } mirroring what the real fzf runner returns.
   */
  function makeFzfQueue(entries: Array<{ stdout: string; exitCode?: number }>) {
    let i = 0;
    return async () => {
      const entry = entries[i++] ?? { stdout: "", exitCode: 130 };
      return { stdout: entry.stdout, exitCode: entry.exitCode ?? 0 };
    };
  }

  it("deletes two worktrees in sequence and ends at mainWorktree", async () => {
    const wtA = path.join(workdir, "repo-da");
    const wtB = path.join(workdir, "repo-db");
    exec(repoDir, "git", ["worktree", "add", "-b", "da", wtA]);
    exec(repoDir, "git", ["worktree", "add", "-b", "db", wtB]);

    const console = new TestConsole();
    // Use fzf mode with a fake runner that:
    // Round 1: section picker → "delete worktree (2)" label; item picker → "delete da" rendered line; confirm="y"
    // Round 2: section picker → "delete worktree (1)"; item picker → "delete db"; confirm="y"
    // The confirm prompts are answered via queueResponses since those use console.ask.
    console.queueResponses("y", "y");

    const runner = makeFzfQueue([
      // Round 1 section picker
      { stdout: "delete worktree (2)\n" },
      // Round 1 item picker — we need to send a rendered line for "da"
      // We don't know exact rendering, so use the prompt mode instead.
    ]);
    void runner;

    // Use prompt mode for simplicity and derive section number from stderr output.
    // We'll inspect stderr to find the correct section number.
    const probeConsole = new TestConsole();
    // Queue a non-existent section number to abort, then read what was printed.
    probeConsole.queueResponses("999");
    await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console: probeConsole,
      selectorOptions: { useFzf: false },
    }).catch(() => {});

    // Find "delete worktree" section number from stderr.
    const sectionMatch = probeConsole.stderr.match(/(\d+)\) delete worktree/);
    const delSection = sectionMatch?.[1] ?? "4";

    // Now run the real test.
    console.queueResponses(
      delSection, "1", "y",   // round 1: section, item, confirm
      delSection, "1", "y",   // round 2: section, item, confirm
    );
    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });

    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(repoDir);
    await expect(stat(wtA)).rejects.toThrow();
    await expect(stat(wtB)).rejects.toThrow();
  });

  it("after delete, cancelling the next delete prompt exits with mainWorktree on stdout", async () => {
    const wtA = path.join(workdir, "repo-dc");
    const wtB = path.join(workdir, "repo-dd");
    exec(repoDir, "git", ["worktree", "add", "-b", "dc", wtA]);
    exec(repoDir, "git", ["worktree", "add", "-b", "dd", wtB]);

    const probeConsole = new TestConsole();
    probeConsole.queueResponses("999");
    await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console: probeConsole,
      selectorOptions: { useFzf: false },
    }).catch(() => {});
    const sectionMatch = probeConsole.stderr.match(/(\d+)\) delete worktree/);
    const delSection = sectionMatch?.[1] ?? "4";

    const console = new TestConsole();
    // Delete wtA, then cancel the confirm for wtB.
    console.queueResponses(
      delSection, "1", "y",   // delete wtA
      delSection, "1", "n",   // cancel wtB
    );
    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });

    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(repoDir);
    await expect(stat(wtA)).rejects.toThrow();
    expect((await stat(wtB)).isDirectory()).toBe(true);
  });

  it("after deleting the only deletable worktree, loop ends automatically", async () => {
    const wtA = path.join(workdir, "repo-dsole");
    exec(repoDir, "git", ["worktree", "add", "-b", "dsole", wtA]);

    const probeConsole = new TestConsole();
    probeConsole.queueResponses("999");
    await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console: probeConsole,
      selectorOptions: { useFzf: false },
    }).catch(() => {});
    const sectionMatch = probeConsole.stderr.match(/(\d+)\) delete worktree/);
    const delSection = sectionMatch?.[1] ?? "4";

    const console = new TestConsole();
    console.queueResponses(delSection, "1", "y");
    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });

    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(repoDir);
    await expect(stat(wtA)).rejects.toThrow();
  });
});

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
