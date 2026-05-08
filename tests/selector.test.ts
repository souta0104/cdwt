import { describe, expect, it } from "vitest";
import {
  COMMAND_SENTINEL,
  selectInteractive,
  type FzfRunner,
} from "../src/ui/selector.js";
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

  it("dispatches `d <num>` as a delete-target outcome", async () => {
    const console = new TestConsole();
    console.queueResponses("d 2");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result.kind).toBe("delete-target");
    if (result.kind === "delete-target") expect(result.line.destination).toBe("/repo-feature");
  });

  it("returns command-mode (with the typed line) when the input starts with /", async () => {
    const console = new TestConsole();
    console.queueResponses("/new feat/x");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result).toEqual({ kind: "command-mode", initialInput: "/new feat/x" });
  });

  it("returns command-mode for a bare / as well", async () => {
    const console = new TestConsole();
    console.queueResponses("/");
    const result = await selectInteractive([MAIN, WT_FEATURE], { console, useFzf: false });
    expect(result).toEqual({ kind: "command-mode", initialInput: "/" });
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

  it("returns command-mode when fzf prints the slash sentinel", async () => {
    const console = new TestConsole();
    // The `/` keybind uses `become(printf ...)` to replace fzf with a printf
    // that writes the sentinel and exits 0.
    const runFzf: FzfRunner = () =>
      Promise.resolve({ exitCode: 0, stdout: `${COMMAND_SENTINEL}\n` });
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result).toEqual({ kind: "command-mode" });
  });

  it("uses become(printf ...) for the / binding so the sentinel survives abort", async () => {
    const console = new TestConsole();
    const seen: string[][] = [];
    const runFzf: FzfRunner = ({ args }) => {
      seen.push(args);
      return Promise.resolve({ exitCode: 130, stdout: "" });
    };
    await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    const slashBind = seen[0]?.find((a) => a.startsWith("--bind=/:"));
    expect(slashBind).toContain("become(");
    expect(slashBind).toContain(COMMAND_SENTINEL);
  });

  it("returns delete-target when ctrl-d is pressed on a highlighted line", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = () =>
      Promise.resolve({ exitCode: 0, stdout: `\nctrl-d\n${renderLine(WT_FEATURE)}\n` });
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result.kind).toBe("delete-target");
    if (result.kind === "delete-target") expect(result.line.destination).toBe("/repo-feature");
  });

  it("ignores ctrl-d when no line is highlighted and re-opens the picker", async () => {
    const console = new TestConsole();
    let calls = 0;
    const runFzf: FzfRunner = () => {
      calls++;
      if (calls === 1) return Promise.resolve({ exitCode: 0, stdout: `\nctrl-d\n\n` });
      return Promise.resolve({ exitCode: 0, stdout: `\n\n${renderLine(WT_FEATURE)}\n` });
    };
    const result = await selectInteractive([MAIN, WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(calls).toBe(2);
    expect(result.kind).toBe("selected");
  });

  it("cycles the filter on tab and re-runs fzf with only the next bucket", async () => {
    const console = new TestConsole();
    const calls: string[][] = [];
    const runFzf: FzfRunner = ({ input }) => {
      calls.push(input.split("\n"));
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
    expect(calls[1]?.some((line) => line.includes("[br]"))).toBe(false);
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
