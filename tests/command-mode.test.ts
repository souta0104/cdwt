import { describe, expect, it } from "vitest";
import { runCommandMode } from "../src/ui/command-mode.js";
import { TestConsole } from "../src/io/test-console.js";
import { SLASH_COMMANDS, findCommand } from "../src/commands/slash-commands.js";
import type { FzfRunner } from "../src/ui/command-mode.js";

describe("runCommandMode prompt fallback", () => {
  it("dispatches `/main` from initialInput without prompting", async () => {
    const console = new TestConsole();
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
      initialInput: "/main",
    });
    expect(result.kind).toBe("command");
    if (result.kind === "command") {
      expect(result.command.name).toBe("main");
      expect(result.args).toBe("");
    }
    expect(console.askedPrompts).toEqual([]);
  });

  it("dispatches `/new feat/x` from initialInput without prompting", async () => {
    const console = new TestConsole();
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
      initialInput: "/new feat/x",
    });
    expect(result.kind).toBe("command");
    if (result.kind === "command") {
      expect(result.command.name).toBe("new");
      expect(result.args).toBe("feat/x");
    }
  });

  it("rejects an unknown initialInput command and re-prompts", async () => {
    const console = new TestConsole();
    console.queueResponses("/main");
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
      initialInput: "/nope",
    });
    expect(console.stderr).toContain("unknown command");
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.command.name).toBe("main");
  });

  it("returns cancelled on EOF at the prompt", async () => {
    const console = new TestConsole();
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
    });
    expect(result.kind).toBe("cancelled");
  });

  it("accepts a numbered selection from the palette", async () => {
    const console = new TestConsole();
    // entry 2 is /main (registry order: new, main, pr, refresh, help)
    console.queueResponses("2");
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
    });
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.command.name).toBe("main");
  });

  it("prompts for the arg when a command with argHint is picked without args", async () => {
    const console = new TestConsole();
    // pick /new (entry 1), then provide branch arg
    console.queueResponses("1", "feat/x");
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
    });
    expect(result.kind).toBe("command");
    if (result.kind === "command") {
      expect(result.command.name).toBe("new");
      expect(result.args).toBe("feat/x");
    }
  });

  it("returns cancelled when the arg prompt is aborted (empty input)", async () => {
    const console = new TestConsole();
    console.queueResponses("1", "");
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
    });
    expect(result.kind).toBe("cancelled");
  });

  it("rejects out-of-range numeric selection and re-prompts", async () => {
    const console = new TestConsole();
    console.queueResponses("99", "2");
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: false,
    });
    expect(console.stderr).toContain("invalid selection");
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.command.name).toBe("main");
  });
});

describe("runCommandMode fzf path", () => {
  it("uses fzf to pick a command and returns it", async () => {
    const console = new TestConsole();
    const mainCmd = findCommand("main")!;
    const runFzf: FzfRunner = ({ args, input }) => {
      expect(args.some((a) => a.startsWith("--prompt="))).toBe(true);
      const lines = input.split("\n");
      const mainLine = lines.find((l) => l.startsWith("/main")) ?? "";
      // stdout layout (no --expect): query \n selected
      return Promise.resolve({ exitCode: 0, stdout: `\n${mainLine}\n` });
    };
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.command.name).toBe(mainCmd.name);
  });

  it("returns cancelled when fzf is aborted", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = () => Promise.resolve({ exitCode: 130, stdout: "" });
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result.kind).toBe("cancelled");
  });

  it("dispatches initialInput before opening fzf", async () => {
    const console = new TestConsole();
    let calls = 0;
    const runFzf: FzfRunner = () => {
      calls++;
      return Promise.resolve({ exitCode: 130, stdout: "" });
    };
    const result = await runCommandMode({
      console,
      registry: SLASH_COMMANDS,
      useFzf: true,
      fzfRunner: runFzf,
      initialInput: "/main",
    });
    expect(calls).toBe(0);
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.command.name).toBe("main");
  });
});
