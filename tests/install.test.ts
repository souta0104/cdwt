import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInstall } from "../src/commands/install.js";
import { TestConsole } from "../src/io/test-console.js";

let home: string;
const SOURCE_LINE = 'source "$HOME/.local/share/cdwt/cdwt.zsh"';

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "cdwt-install-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("runInstall", () => {
  it("creates the shell wrapper file with mode 0644", async () => {
    const console = new TestConsole();
    const code = await runInstall({ home, console });
    expect(code).toBe(0);
    const wrapperPath = path.join(home, ".local", "share", "cdwt", "cdwt.zsh");
    const contents = await readFile(wrapperPath, "utf8");
    expect(contents).toContain("cdwt() {");
    expect(contents).toContain("cdwt-select");
    const mode = (await stat(wrapperPath)).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("creates an rc file when none exists and adds the source line", async () => {
    const console = new TestConsole();
    await runInstall({ home, console });
    const rc = await readFile(path.join(home, ".zshrc"), "utf8");
    expect(rc).toBe(`${SOURCE_LINE}\n`);
  });

  it("appends to an existing rc file without an extra blank line", async () => {
    const rcFile = path.join(home, ".zshrc");
    await writeFile(rcFile, "alias l='ls -la'\n");
    const console = new TestConsole();
    await runInstall({ home, console });
    const rc = await readFile(rcFile, "utf8");
    expect(rc).toBe(`alias l='ls -la'\n${SOURCE_LINE}\n`);
  });

  it("is idempotent: a second run does not duplicate the source line", async () => {
    const console = new TestConsole();
    await runInstall({ home, console });
    await runInstall({ home, console });
    const rc = await readFile(path.join(home, ".zshrc"), "utf8");
    const occurrences = rc.split("\n").filter((l) => l.trim() === SOURCE_LINE).length;
    expect(occurrences).toBe(1);
  });

  it("respects an explicit rcFile path", async () => {
    const customRc = path.join(home, "custom.rc");
    const console = new TestConsole();
    await runInstall({ home, console, rcFile: customRc });
    const rc = await readFile(customRc, "utf8");
    expect(rc).toContain(SOURCE_LINE);
  });

  it("logs the wrapper and rc file paths via the console (no process writes)", async () => {
    const console = new TestConsole();
    await runInstall({ home, console });
    expect(console.stdout).toContain("installed shell wrapper to");
    expect(console.stdout).toContain(path.join(home, ".local", "share", "cdwt", "cdwt.zsh"));
    expect(console.stdout).toContain(path.join(home, ".zshrc"));
  });
});
