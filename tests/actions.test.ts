import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_CANCELLED,
  createNewWorktreeAction,
  createWorktreeForBranchAction,
  deleteWorktreeAction,
  goToPrWorktreeAction,
  printDestination,
  type ActionContext,
} from "../src/commands/actions.js";
import { TestConsole } from "../src/io/test-console.js";
import { loadRepoContext } from "../src/io/repo-context.js";
import { deriveBranchesWithWorktree } from "../src/core/sections.js";
import { makePrPath } from "../src/core/paths.js";

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

  it("warns when called directly from a terminal without the shell wrapper", () => {
    const console = new TestConsole();
    withStdoutTty(true, () => {
      const previous = process.env["CDWT_SHELL_WRAPPER"];
      delete process.env["CDWT_SHELL_WRAPPER"];
      try {
        printDestination(console, "/some/path");
      } finally {
        restoreEnv("CDWT_SHELL_WRAPPER", previous);
      }
    });
    expect(console.stdout).toBe("/some/path\n");
    expect(console.stderr).toContain("shell integration is not loaded");
    expect(console.stderr).toContain("cdwt install");
  });

  it("does not warn when called through the shell wrapper", () => {
    const console = new TestConsole();
    withStdoutTty(true, () => {
      const previous = process.env["CDWT_SHELL_WRAPPER"];
      process.env["CDWT_SHELL_WRAPPER"] = "1";
      try {
        printDestination(console, "/some/path");
      } finally {
        restoreEnv("CDWT_SHELL_WRAPPER", previous);
      }
    });
    expect(console.stdout).toBe("/some/path\n");
    expect(console.stderr).toBe("");
  });
});

describe("createWorktreeForBranchAction", () => {
  it("creates the worktree without prompting and prints the destination", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const { ctx, console } = await makeContext();
    const target = path.join(workdir, "repo-feature");
    const code = await createWorktreeForBranchAction(ctx, "feature", target);
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(target);
    expect((await stat(target)).isDirectory()).toBe(true);
    expect(console.askedPrompts).toEqual([]);
  });

  it("throws when the destination already exists", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const target = path.join(workdir, "repo-feature-exists");
    await mkdir(target, { recursive: true });
    const { ctx } = await makeContext();
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

    const { ctx, console } = await makeContext();
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

    const { ctx, console } = await makeContext();
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
  it("creates a worktree directly when given a branch arg (no prompts)", async () => {
    const expectedTarget = path.join(workdir, "repo-fresh-branch");
    const { ctx, console } = await makeContext();
    const code = await createNewWorktreeAction(ctx, "fresh-branch");
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(expectedTarget);
    expect((await stat(expectedTarget)).isDirectory()).toBe(true);
    expect(console.askedPrompts).toEqual([]);
  });

  it("falls back to prompting when no branch arg is supplied", async () => {
    const branchName = "interactive-branch";
    const expectedTarget = path.join(workdir, "repo-interactive-branch");
    const { ctx, console } = await makeContext({ responses: [branchName] });
    const code = await createNewWorktreeAction(ctx);
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(expectedTarget);
  });

  it("returns EXIT_CANCELLED when the branch prompt receives EOF", async () => {
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

  it("rejects a branch arg that already exists", async () => {
    exec(repoDir, "git", ["branch", "exists"]);
    const { ctx, console } = await makeContext();
    const code = await createNewWorktreeAction(ctx, "exists");
    expect(code).toBe(EXIT_CANCELLED);
    expect(console.stderr).toContain("branch already exists: exists");
  });
});

describe("goToPrWorktreeAction", () => {
  it("prints the existing PR worktree path without creating it", async () => {
    const { ctx, console } = await makeContext();
    const target = makePrPath(42, ctx.repo.mainWorktree, ctx.repo.repoName);
    await mkdir(target, { recursive: true });
    const code = await goToPrWorktreeAction(ctx, 42);
    expect(code).toBe(0);
    expect(console.stdout.trim()).toBe(target);
    expect(console.askedPrompts).toEqual([]);
  });

  it("redirects to the branch's existing worktree instead of creating repo-pr-<n>", async () => {
    const target = path.join(workdir, "repo-feature-x");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature-x", target]);
    const { ctx, console } = await makeContext();
    const prPath = makePrPath(99, ctx.repo.mainWorktree, ctx.repo.repoName);

    await withFakeGh(
      {
        CDWT_TEST_GH_VIEW_JSON: JSON.stringify({ headRefName: "feature-x" }),
        CDWT_TEST_GH_CHECKOUT_EXIT: "1",
      },
      async () => {
        const code = await goToPrWorktreeAction(ctx, 99);
        expect(code).toBe(0);
        expect(console.stdout.trim()).toBe(target);
      },
    );
    await expect(stat(prPath)).rejects.toThrow();
  });

  it("falls back to the create flow when gh can't resolve the PR's head branch", async () => {
    const { ctx, console } = await makeContext();
    const prPath = makePrPath(123, ctx.repo.mainWorktree, ctx.repo.repoName);

    await withFakeGh({ CDWT_TEST_GH_VIEW_EXIT: "1", CDWT_TEST_GH_CHECKOUT_EXIT: "0" }, async () => {
      const code = await goToPrWorktreeAction(ctx, 123);
      expect(code).toBe(0);
      expect(console.stdout.trim()).toBe(prPath);
    });
    expect((await stat(prPath)).isDirectory()).toBe(true);
  });
});

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}

function withStdoutTty(value: boolean, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
  try {
    callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "isTTY", descriptor);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  }
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

const FAKE_GH_SCRIPT = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  exit_code="\${CDWT_TEST_GH_VIEW_EXIT:-0}"
  [ "$exit_code" != "0" ] && exit "$exit_code"
  printf '%s' "\${CDWT_TEST_GH_VIEW_JSON:-null}"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "checkout" ]; then
  exit "\${CDWT_TEST_GH_CHECKOUT_EXIT:-0}"
fi
exit 1
`;

/**
 * Puts a fake `gh` executable on PATH for the duration of `fn`, driven by the
 * given env vars (see FAKE_GH_SCRIPT), then restores PATH and those vars.
 */
async function withFakeGh(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const binDir = path.join(workdir, "fake-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  await writeFile(ghPath, FAKE_GH_SCRIPT);
  await chmod(ghPath, 0o755);

  const previousPath = process.env["PATH"];
  const previousEnv = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  process.env["PATH"] = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  try {
    await fn();
  } finally {
    restoreEnv("PATH", previousPath);
    for (const [k, v] of Object.entries(previousEnv)) restoreEnv(k, v);
  }
}
