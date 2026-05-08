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

describe("runSelect delete flow (d <num>)", () => {
  it("deletes two worktrees in sequence and ends at mainWorktree", async () => {
    const wtA = path.join(workdir, "repo-da");
    const wtB = path.join(workdir, "repo-db");
    exec(repoDir, "git", ["worktree", "add", "-b", "da", wtA]);
    exec(repoDir, "git", ["worktree", "add", "-b", "db", wtB]);

    const console = new TestConsole();
    // prompt fallback flow:
    // 1. picker → "d 2" picks first wt (entry 1 is mainWorktree, 2 is wtA)
    // 2. confirm "y"
    // 3. picker → "d 2" picks remaining wt
    // 4. confirm "y"
    console.queueResponses("d 2", "y", "d 2", "y");

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

  it("declining the confirm leaves the worktree in place and re-opens the picker", async () => {
    const wtA = path.join(workdir, "repo-dc");
    const wtB = path.join(workdir, "repo-dd");
    exec(repoDir, "git", ["worktree", "add", "-b", "dc", wtA]);
    exec(repoDir, "git", ["worktree", "add", "-b", "dd", wtB]);

    const console = new TestConsole();
    // d 2 → confirm y (deletes wtA) → d 2 → confirm n (cancels) → picker EOF cancels.
    console.queueResponses("d 2", "y", "d 2", "n");

    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });

    expect(code).toBe(130);
    const aGone = await stat(wtA).then(() => false).catch(() => true);
    const bGone = await stat(wtB).then(() => false).catch(() => true);
    expect(aGone !== bGone).toBe(true);
  });

  it("rejects deleting the main worktree and re-opens the picker", async () => {
    exec(repoDir, "git", ["worktree", "add", "-b", "keep", path.join(workdir, "repo-keep")]);

    const console = new TestConsole();
    // d 1 targets the [main] row → rejected, then EOF cancels.
    console.queueResponses("d 1");

    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });

    expect(code).toBe(130);
    expect(console.stderr).toContain("refusing to delete the default branch worktree");
  });

  it("/main jumps directly to mainWorktree", async () => {
    const console = new TestConsole();
    console.queueResponses("/main");
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
  });

  it("/new <branch> creates a worktree from the default branch", async () => {
    const console = new TestConsole();
    console.queueResponses("/new shiny");
    const code = await runSelect({
      defaultBranchOnly: false,
      cwd: repoDir,
      configOverride: undefined,
      home,
      console,
      selectorOptions: { useFzf: false },
    });
    expect(code).toBe(0);
    const expected = path.join(workdir, "repo-shiny");
    expect(console.stdout.trim()).toBe(expected);
    expect((await stat(expected)).isDirectory()).toBe(true);
  });
});

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
