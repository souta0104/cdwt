import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRepoContext } from "../src/io/repo-context.js";
import { discoverConfigFiles, readMergedConfig } from "../src/io/config-loader.js";

let workdir: string;
let repoDir: string;
let cliPath: string;

beforeEach(async () => {
  workdir = await realpath(await mkdtemp(path.join(tmpdir(), "cdwt-it-")));
  repoDir = path.join(workdir, "repo");
  await mkdir(repoDir, { recursive: true });
  exec(repoDir, "git", ["init", "-q", "-b", "main"]);
  exec(repoDir, "git", ["config", "user.email", "test@example.com"]);
  exec(repoDir, "git", ["config", "user.name", "Test"]);
  exec(repoDir, "git", ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repoDir, "README.md"), "# repo\n");
  exec(repoDir, "git", ["add", "."]);
  exec(repoDir, "git", ["commit", "-q", "-m", "init"]);
  cliPath = path.join(process.cwd(), "dist", "cli.js");
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("repo context", () => {
  it("identifies the main worktree and default branch", async () => {
    const ctx = await loadRepoContext(repoDir);
    expect(ctx.mainWorktree).toBe(repoDir);
    expect(ctx.repoName).toBe("repo");
    expect(ctx.defaultBranch).toBe("main");
    expect(ctx.defaultBranchRef).toBe("main");
    expect(ctx.worktrees).toHaveLength(1);
    expect(ctx.worktrees[0]?.branch).toBe("main");
  });

  it("lists additional worktrees", async () => {
    const featurePath = path.join(workdir, "repo-feature");
    exec(repoDir, "git", ["worktree", "add", "-b", "feature", featurePath]);
    const ctx = await loadRepoContext(repoDir);
    const branches = ctx.worktrees.map((w) => w.branch).sort();
    expect(branches).toContain("feature");
    expect(branches).toContain("main");
  });
});

describe("config loader", () => {
  it("merges $HOME, parent, and repo configs in weak-to-strong order", async () => {
    const home = path.join(workdir, "home");
    await mkdir(path.join(home, ".cdwt"), { recursive: true });
    await writeFile(
      path.join(home, ".cdwt", "settings.json"),
      JSON.stringify({ copyIgnored: { paths: ["home-only.txt"], patterns: ["*.home"] } }),
    );
    await mkdir(path.join(repoDir, ".cdwt"), { recursive: true });
    await writeFile(
      path.join(repoDir, ".cdwt", "settings.json"),
      JSON.stringify({ copyIgnored: { paths: ["repo-only.txt"] } }),
    );
    const files = await discoverConfigFiles({
      cwd: repoDir,
      mainWorktree: repoDir,
      home,
      override: undefined,
    });
    expect(files).toHaveLength(2);
    const merged = await readMergedConfig(files);
    expect(merged.copyIgnored.paths).toEqual(["repo-only.txt"]);
    expect(merged.copyIgnored.patterns).toEqual(["*.home"]);
  });

  it("uses CDWT_CONFIG override exclusively", async () => {
    const override = path.join(workdir, "explicit.json");
    await writeFile(override, JSON.stringify({ copyIgnored: { patterns: ["*.local"] } }));
    const home = path.join(workdir, "home");
    await mkdir(path.join(home, ".cdwt"), { recursive: true });
    await writeFile(
      path.join(home, ".cdwt", "settings.json"),
      JSON.stringify({ copyIgnored: { paths: ["should-be-ignored"] } }),
    );
    const files = await discoverConfigFiles({
      cwd: repoDir,
      mainWorktree: repoDir,
      home,
      override,
    });
    expect(files).toEqual([override]);
    const merged = await readMergedConfig(files);
    expect(merged.copyIgnored.paths).toEqual([]);
    expect(merged.copyIgnored.patterns).toEqual(["*.local"]);
  });
});

describe("--default-branch CLI", () => {
  it("prints the main worktree path and exits 0", () => {
    const out = execFileSync("node", [cliPath, "--default-branch"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    expect(out.trim()).toBe(repoDir);
  });
});

describe("inheritStdio keeps the parent's stdout clean", () => {
  // Regression test for the shell-wrapper hang. The wrapper does
  //   destination="$(command cdwt)"
  // so anything that escapes to the child's stdout other than the destination
  // path corrupts the cd target. `git worktree add` writes "HEAD is now at ..."
  // to stdout, and `inheritStdio: true` used to forward that into the parent's
  // stdout. After the fix the child's stdout is rerouted to the parent's stderr.
  it("forwards the inherited child's stdout to the parent's stderr only", async () => {
    exec(repoDir, "git", ["branch", "feature"]);
    const target = path.join(workdir, "repo-feature");
    const driver = `
      import { run } from "${path.join(process.cwd(), "src", "io", "exec.ts").replace(/\\\\/g, "/")}";
      const r = await run("git", ["worktree", "add", ${JSON.stringify(target)}, "feature"], {
        cwd: ${JSON.stringify(repoDir)},
        inheritStdio: true,
      });
      process.stdout.write(${JSON.stringify(target)} + "\\n");
      process.exit(r.exitCode);
    `;
    const { spawn } = await import("node:child_process");
    const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const result: { exitCode: number; stdout: string; stderr: string } = await new Promise(
      (resolve, reject) => {
        const child = spawn(tsxBin, ["--eval", driver, "--input-type=module"], {
          cwd: repoDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout!.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
        child.stderr!.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
        child.on("error", reject);
        child.on("close", (code: number | null) =>
          resolve({ exitCode: code ?? 0, stdout, stderr }),
        );
        child.stdin!.end();
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(target);
    expect(result.stdout).not.toMatch(/HEAD is now at/);
    expect(result.stderr).toMatch(/HEAD is now at/);
    expect(result.stderr).toMatch(/Preparing worktree/);
  });
});

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
