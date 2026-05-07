import { describe, expect, it } from "vitest";
import { parseSlashCommand, selectInteractive, type FzfRunner } from "../src/ui/selector.js";
import { TestConsole } from "../src/io/test-console.js";
import { renderLine } from "../src/ui/format.js";
import type { DisplayLine } from "../src/types.js";

function dl(overrides: Partial<DisplayLine>): DisplayLine {
  return {
    kind: "worktree",
    section: "wt",
    name: "name",
    shortPath: ".",
    fullPath: "/p",
    destination: "/p",
    branch: "",
    prNumber: null,
    ...overrides,
  };
}

const MAIN = dl({ kind: "worktree", section: "main", name: "repo", destination: "/repo" });
const WT_FEATURE = dl({
  kind: "worktree",
  section: "wt",
  name: "feature",
  destination: "/repo-feature",
});
const WT_BUGFIX = dl({
  kind: "worktree",
  section: "wt",
  name: "bugfix",
  destination: "/repo-bugfix",
});
const BR_DRAFT = dl({
  kind: "branch",
  section: "br",
  name: "draft",
  destination: "/repo-draft",
});

describe("parseSlashCommand", () => {
  it.each([
    ["/main", { kind: "main" }],
    ["/home", { kind: "main" }],
    ["/delete", { kind: "delete" }],
    ["/d", { kind: "delete" }],
    ["/pr", { kind: "pr" }],
    ["/refresh", { kind: "refresh" }],
    ["/r", { kind: "refresh" }],
    ["/help", { kind: "help" }],
    ["/h", { kind: "help" }],
    ["/?", { kind: "help" }],
    ["/new feat/x", { kind: "new", branch: "feat/x" }],
    ["/n feat/x", { kind: "new", branch: "feat/x" }],
  ] as const)("parses %p", (input, expected) => {
    expect(parseSlashCommand(input)).toEqual(expected);
  });

  it("returns help for /new without an argument", () => {
    expect(parseSlashCommand("/new")).toEqual({ kind: "help" });
  });

  it("returns null for unknown slash commands", () => {
    expect(parseSlashCommand("/unknown")).toBeNull();
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("foo")).toBeNull();
  });
});

describe("selectInteractive prompt fallback", () => {
  it("returns cancelled when there are no entries", async () => {
    const console = new TestConsole();
    const result = await selectInteractive([], { console, useFzf: false });
    expect(result.kind).toBe("cancelled");
  });

  it("returns the picked line by 1-based index", async () => {
    const console = new TestConsole();
    console.queueResponses("2");
    const result = await selectInteractive([MAIN, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: false,
    });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") expect(result.line.destination).toBe("/repo-feature");
  });

  it("re-prompts on invalid input", async () => {
    const console = new TestConsole();
    console.queueResponses("nope", "0", "2");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") expect(result.line.destination).toBe("/repo-feature");
    expect(console.stderr.match(/invalid selection/g)?.length).toBe(2);
  });

  it("returns cancelled on EOF (null answer)", async () => {
    const console = new TestConsole();
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result.kind).toBe("cancelled");
  });

  it("dispatches /delete as a slash command", async () => {
    const console = new TestConsole();
    console.queueResponses("/delete");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result).toEqual({ kind: "slash", command: { kind: "delete" } });
  });

  it("dispatches /new feat/x as a slash command with the branch arg", async () => {
    const console = new TestConsole();
    console.queueResponses("/new feat/x");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result).toEqual({ kind: "slash", command: { kind: "new", branch: "feat/x" } });
  });

  it("rejects unknown slash commands and re-prompts", async () => {
    const console = new TestConsole();
    console.queueResponses("/unknown", "1");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result.kind).toBe("selected");
    expect(console.stderr).toContain("unknown command");
  });
});

describe("selectInteractive fzf path (with injected runner)", () => {
  it("returns the selected line for a normal pick", async () => {
    const console = new TestConsole();
    let calls = 0;
    const runFzf: FzfRunner = ({ args, input }) => {
      calls++;
      expect(args.some((a) => a === "--prompt=> ")).toBe(true);
      expect(input.split("\n")).toContain(renderLine(WT_FEATURE));
      // stdout: query \n key \n selected
      return Promise.resolve({ exitCode: 0, stdout: `\n\n${renderLine(WT_FEATURE)}\n` });
    };
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(calls).toBe(1);
    expect(result.kind).toBe("selected");
    if (result.kind === "selected") expect(result.line.destination).toBe("/repo-feature");
  });

  it("returns cancelled when fzf exits non-zero with empty stdout (esc/abort)", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = () => Promise.resolve({ exitCode: 130, stdout: "" });
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result.kind).toBe("cancelled");
  });

  it("interprets a query starting with / as a slash command", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = () =>
      Promise.resolve({ exitCode: 0, stdout: `/delete\n\n\n` });
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result).toEqual({ kind: "slash", command: { kind: "delete" } });
  });

  it("cycles the filter on tab and re-runs fzf with only the next bucket", async () => {
    const console = new TestConsole();
    const calls: string[][] = [];
    const runFzf: FzfRunner = ({ input }) => {
      calls.push(input.split("\n"));
      // first call: tab pressed; second call: pick BR_DRAFT
      if (calls.length === 1) {
        return Promise.resolve({ exitCode: 0, stdout: `\ntab\n\n` });
      }
      return Promise.resolve({ exitCode: 0, stdout: `\n\n${renderLine(BR_DRAFT)}\n` });
    };
    const result = await selectInteractive([MAIN, WT_FEATURE, BR_DRAFT], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    // After tab from "all": next is "wt" - branches filtered out
    expect(calls[1]?.some((line) => line.includes("[br]"))).toBe(false);
    // Eventually after enough tabs the runner returns BR_DRAFT
    if (result.kind === "selected") expect(result.line.destination).toBe("/repo-draft");
  });

  it("opens the help overlay on ? key, then re-opens the picker", async () => {
    const console = new TestConsole();
    const calls: string[] = [];
    const runFzf: FzfRunner = ({ args }) => {
      if (args.some((a) => a === "--prompt=help> ")) {
        calls.push("help");
        return Promise.resolve({ exitCode: 130, stdout: "" });
      }
      calls.push("main");
      if (calls.filter((c) => c === "main").length === 1) {
        return Promise.resolve({ exitCode: 0, stdout: `\n?\n\n` });
      }
      return Promise.resolve({ exitCode: 0, stdout: `\n\n${renderLine(WT_FEATURE)}\n` });
    };
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(calls).toEqual(["main", "help", "main"]);
    expect(result.kind).toBe("selected");
  });
});
