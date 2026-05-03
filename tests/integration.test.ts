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

function exec(cwd: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}
