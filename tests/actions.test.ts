import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_CANCELLED,
  createNewWorktreeAction,
  createWorktreeForBranchAction,
  deleteWorktreeAction,
  printDestination,
  type ActionContext,
} from "../src/commands/actions.js";
import { TestConsole } from "../src/io/test-console.js";
import { loadRepoContext } from "../src/io/repo-context.js";
import { deriveBranchesWithWorktree } from "../src/core/sections.js";

let workdir: string;
let repoDir: string;

beforeEach(async () => {
  workdir = await realpath(await mkdtemp(path.join(tmpdir(), "cdwt-actions-")));
  repoDir = path.join(workdir, "repo");
  await mkdir(repoDir, { recursive: true });
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

async function makeContext(extra: { responses?: (string | null)[] } = {}): Promise<{
  ctx: ActionContext;
  console: TestConsole;
}> {
  const repo = await loadRepoContext(repoDir);
  const console = new TestConsole();
  if (extra.responses) console.queueResponses(...extra.responses);
  const ctx: ActionContext = {
    repo,
    config: { copyIgnored: { paths: [], patterns: [] } },
    branchesWithWorktree: deriveBranchesWithWorktree(repo),
    console,
  };
  return { ctx, console };
}

describe("printDestination", () => {
  it("writes the path with a trailing newline to stdout only", () => {
    const console = new TestConsole();
    printDestination(console, "/some/path");
    expect(console.stdout).toBe("/some/path\n");
    expect(console.stderr).toBe("");
  });
});

describe("createWorktreeForBranchAction", () => {
  it("creates the worktree on confirm and prints the destination", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const { ctx, console } = await makeContext({ responses: ["y"] });
    const target = path.join(workdir, "repo-feature");
    const code = await createWorktreeForBranchAction(ctx, "feature", target);
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(target);
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it("returns EXIT_CANCELLED when the user declines and does not touch the FS", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const { ctx } = await makeContext({ responses: ["n"] });
    const target = path.join(workdir, "repo-feature-cancel");
    const code = await createWorktreeForBranchAction(ctx, "feature", target);
    expect(code).toBe(EXIT_CANCELLED);
    await expect(stat(target)).rejects.toThrow();
  });

  it("throws when the destination already exists", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const target = path.join(workdir, "repo-feature-exists");
    await mkdir(target, { recursive: true });
    const { ctx } = await makeContext({ responses: ["y"] });
    await expect(createWorktreeForBranchAction(ctx, "feature", target)).rejects.toThrow(
      /destination already exists/,
    );
  });

  it("copies copyIgnored.paths into the new worktree (only if git-ignored)", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    await writeFile(path.join(repoDir, ".gitignore"), ".env\n");
    exec(repoDir, "git", ["add", ".gitignore"]);
    exec(repoDir, "git", ["commit", "-q", "-m", "ignore env"]);
    await writeFile(path.join(repoDir, ".env"), "SECRET=1\n");

    const { ctx, console } = await makeContext({ responses: ["y"] });
    ctx.config.copyIgnored.paths = [".env"];
    const target = path.join(workdir, "repo-feature-with-env");
    const code = await createWorktreeForBranchAction(ctx, "feature", target);
    expect(code).toBe(0);
    expect(await readFile(path.join(target, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(console.stderr).not.toContain("not ignored by git");
  });

  it("warns and skips a copyIgnored path that is tracked by git", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    await writeFile(path.join(repoDir, "tracked.txt"), "x\n");
    exec(repoDir, "git", ["add", "tracked.txt"]);
    exec(repoDir, "git", ["commit", "-q", "-m", "tracked"]);

    const { ctx, console } = await makeContext({ responses: ["y"] });
    ctx.config.copyIgnored.paths = ["tracked.txt"];
    const target = path.join(workdir, "repo-feature-tracked");
    await createWorktreeForBranchAction(ctx, "feature", target);
    expect(console.stderr).toContain("not ignored by git");
  });
});

describe("deleteWorktreeAction", () => {
  it("refuses to delete the main worktree", async () => {
    const { ctx } = await makeContext();
    await expect(deleteWorktreeAction(ctx, repoDir)).rejects.toThrow(
      /refusing to delete the default branch worktree/,
    );
  });

  it("returns cancelled when the user declines the initial prompt", async () => {
    const target = path.join(workdir, "repo-feature-del");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature-del", target]);
    const { ctx } = await makeContext({ responses: ["n"] });
    const outcome = await deleteWorktreeAction(ctx, target);
    expect(outcome).toEqual({ kind: "cancelled" });
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it("returns deleted on confirm and removes the worktree (clean)", async () => {
    const target = path.join(workdir, "repo-feature-del2");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature-del2", target]);
    const { ctx, console } = await makeContext({ responses: ["y"] });
    const outcome = await deleteWorktreeAction(ctx, target);
    expect(outcome).toEqual({ kind: "deleted" });
    // deleteWorktreeAction no longer prints a destination; that's runSelect's job.
    expect(console.stdout).toBe("");
    await expect(stat(target)).rejects.toThrow();
  });

  it("dirty worktree: first yes, second yes → force deletes and returns deleted", async () => {
    const target = path.join(workdir, "repo-feature-dirty");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature-dirty", target]);
    // Make the worktree dirty with an untracked file.
    await writeFile(path.join(target, "dirty.txt"), "dirty\n");
    // Respond "y" to initial delete prompt, "y" to force prompt.
    const { ctx } = await makeContext({ responses: ["y", "y"] });
    const outcome = await deleteWorktreeAction(ctx, target);
    expect(outcome).toEqual({ kind: "deleted" });
    await expect(stat(target)).rejects.toThrow();
  });

  it("dirty worktree: first yes, second no → returns cancelled, worktree still exists", async () => {
    const target = path.join(workdir, "repo-feature-dirty2");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature-dirty2", target]);
    await writeFile(path.join(target, "dirty.txt"), "dirty\n");
    // "y" to initial delete, "n" to force prompt.
    const { ctx } = await makeContext({ responses: ["y", "n"] });
    const outcome = await deleteWorktreeAction(ctx, target);
    expect(outcome).toEqual({ kind: "cancelled" });
    expect((await stat(target)).isDirectory()).toBe(true);
  });
});

describe("createNewWorktreeAction", () => {
  it("creates a new branch and worktree from the default branch", async () => {
    const branchName = "fresh-branch";
    const expectedTarget = path.join(workdir, "repo-fresh-branch");
    const { ctx, console } = await makeContext({ responses: [branchName, "y"] });
    const code = await createNewWorktreeAction(ctx);
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(expectedTarget);
    expect((await stat(expectedTarget)).isDirectory()).toBe(true);
  });

  it("returns EXIT_CANCELLED when the branch prompt receives EOF", async () => {
    // No queued responses → ask returns null on first call.
    const { ctx } = await makeContext();
    const code = await createNewWorktreeAction(ctx);
    expect(code).toBe(EXIT_CANCELLED);
  });

  it("re-prompts on invalid branch names and gives up after the retry budget", async () => {
    const { ctx, console } = await makeContext({
      responses: ["bad..name", "another bad one", "..", "no/", "ends/"],
    });
    const code = await createNewWorktreeAction(ctx);
    expect(code).toBe(EXIT_CANCELLED);
    expect(console.stderr).toContain("invalid branch name");
    expect(console.stderr).toContain("too many invalid branch name attempts");
  });

  it("rejects a branch that already exists", async () => {
    exec(repoDir, "git", ["branch", "exists"]);
    const { ctx, console } = await makeContext({ responses: ["exists", ""] });
    const code = await createNewWorktreeAction(ctx);
    expect(code).toBe(EXIT_CANCELLED);
    expect(console.stderr).toContain("branch already exists: exists");
  });
});

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
