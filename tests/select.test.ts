import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
