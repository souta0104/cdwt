import { describe, expect, it, vi } from "vitest";
import {
  SLASH_COMMANDS,
  buildHelpText,
  findCommand,
  parseCommandLine,
  type CommandHost,
} from "../src/commands/slash-commands.js";
import { TestConsole } from "../src/io/test-console.js";

function makeHost(overrides: Partial<CommandHost> = {}): CommandHost {
  const console = new TestConsole();
  return {
    console,
    printMainDestination: vi.fn(),
    createNewWorktree: vi.fn(() => Promise.resolve(0)),
    loadPrs: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("findCommand", () => {
  it("returns the command for its primary name", () => {
    expect(findCommand("new")?.name).toBe("new");
    expect(findCommand("main")?.name).toBe("main");
    expect(findCommand("pr")?.name).toBe("pr");
    expect(findCommand("refresh")?.name).toBe("refresh");
    expect(findCommand("help")?.name).toBe("help");
  });

  it("returns the command for any of its aliases", () => {
    expect(findCommand("n")?.name).toBe("new");
    expect(findCommand("home")?.name).toBe("main");
    expect(findCommand("reload")?.name).toBe("refresh");
    expect(findCommand("r")?.name).toBe("refresh");
    expect(findCommand("h")?.name).toBe("help");
    expect(findCommand("?")?.name).toBe("help");
  });

  it("returns null for unknown names and empty strings", () => {
    expect(findCommand("unknown")).toBeNull();
    expect(findCommand("")).toBeNull();
  });
});

describe("parseCommandLine", () => {
  it("parses a bare command name", () => {
    const parsed = parseCommandLine("/main");
    expect(parsed?.command.name).toBe("main");
    expect(parsed?.args).toBe("");
  });

  it("parses a command with arguments", () => {
    const parsed = parseCommandLine("/new feat/x");
    expect(parsed?.command.name).toBe("new");
    expect(parsed?.args).toBe("feat/x");
  });

  it("preserves multi-word arguments verbatim", () => {
    const parsed = parseCommandLine("/new   feat   xy");
    expect(parsed?.command.name).toBe("new");
    expect(parsed?.args).toBe("feat xy");
  });

  it("resolves aliases to their primary command", () => {
    expect(parseCommandLine("/n foo")?.command.name).toBe("new");
    expect(parseCommandLine("/home")?.command.name).toBe("main");
  });

  it("returns null for non-slash input", () => {
    expect(parseCommandLine("main")).toBeNull();
    expect(parseCommandLine("")).toBeNull();
  });

  it("returns null for unknown commands", () => {
    expect(parseCommandLine("/nope")).toBeNull();
  });

  it("returns null for an empty slash", () => {
    expect(parseCommandLine("/")).toBeNull();
    expect(parseCommandLine("/   ")).toBeNull();
  });
});

describe("SLASH_COMMANDS executors", () => {
  it("/main calls printMainDestination and exits 0", async () => {
    const printMainDestination = vi.fn();
    const host = makeHost({ printMainDestination });
    const result = await findCommand("main")!.execute("", host);
    expect(printMainDestination).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: "exit", code: 0 });
  });

  it("/new <branch> forwards the trimmed branch to createNewWorktree", async () => {
    const create = vi.fn(() => Promise.resolve(0));
    const host = makeHost({ createNewWorktree: create });
    const result = await findCommand("new")!.execute("  feat/x  ", host);
    expect(create).toHaveBeenCalledWith("feat/x");
    expect(result).toEqual({ kind: "exit", code: 0 });
  });

  it("/new (no args) forwards undefined to createNewWorktree", async () => {
    const create = vi.fn(() => Promise.resolve(0));
    const host = makeHost({ createNewWorktree: create });
    await findCommand("new")!.execute("", host);
    expect(create).toHaveBeenCalledWith(undefined);
  });

  it("/pr loads PRs once and continues the picker loop", async () => {
    const loadPrs = vi.fn(() => Promise.resolve());
    const host = makeHost({ loadPrs });
    const result = await findCommand("pr")!.execute("", host);
    expect(loadPrs).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: "continue" });
  });

  it("/refresh calls refresh and continues", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const host = makeHost({ refresh });
    const result = await findCommand("refresh")!.execute("", host);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: "continue" });
  });

  it("/help writes the help text to stderr and continues", async () => {
    const console = new TestConsole();
    const host = makeHost({ console });
    const result = await findCommand("help")!.execute("", host);
    expect(console.stderr).toContain("/new");
    expect(console.stderr).toContain("/main");
    expect(result).toEqual({ kind: "continue" });
  });
});

describe("buildHelpText", () => {
  it("renders one line per command including aliases and descriptions", () => {
    const text = buildHelpText(SLASH_COMMANDS);
    for (const cmd of SLASH_COMMANDS) {
      expect(text).toContain(`/${cmd.name}`);
      expect(text).toContain(cmd.description);
    }
    expect(text).toContain("/n");
    expect(text).toContain("/home");
  });
});
