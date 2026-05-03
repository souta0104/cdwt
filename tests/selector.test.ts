import { describe, expect, it } from "vitest";
import { selectInteractive, type FzfRunner } from "../src/ui/selector.js";
import { TestConsole } from "../src/io/test-console.js";
import { renderLine, renderSearchLine } from "../src/ui/format.js";
import type { DisplayLine } from "../src/types.js";

function dl(overrides: Partial<DisplayLine>): DisplayLine {
  return {
    kind: "worktree",
    section: "worktree",
    name: "name",
    shortPath: ".",
    fullPath: "/p",
    destination: "/p",
    branch: "",
    prNumber: null,
    ...overrides,
  };
}

const ROOT = dl({ kind: "worktree", section: "root", name: "repo", destination: "/repo" });
const WT_FEATURE = dl({
  kind: "worktree",
  section: "worktree",
  name: "feature",
  destination: "/repo-feature",
});
const WT_BUGFIX = dl({
  kind: "worktree",
  section: "worktree",
  name: "bugfix",
  destination: "/repo-bugfix",
});

describe("selectInteractive prompt fallback", () => {
  it("returns null when there are no entries", async () => {
    const console = new TestConsole();
    const result = await selectInteractive([], { console, useFzf: false });
    expect(result).toBeNull();
  });

  it("skips the section step when only one section is present", async () => {
    const console = new TestConsole();
    console.queueResponses("1");
    const result = await selectInteractive([WT_FEATURE], { console, useFzf: false });
    expect(result?.destination).toBe("/repo-feature");
    expect(console.stderr).not.toContain("Sections:");
  });

  it("returns the selected entry from the chosen section", async () => {
    const console = new TestConsole();
    // section 1 (root), then destination 1
    console.queueResponses("1", "1");
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: false,
    });
    expect(result?.destination).toBe("/repo");
  });

  it("re-prompts on invalid section input", async () => {
    const console = new TestConsole();
    console.queueResponses("nope", "0", "2", "1");
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: false,
    });
    // section 2 = worktree (root has 1 entry, worktree has 2). Selected destination 1 = feature.
    expect(result?.destination).toBe("/repo-feature");
    expect(console.stderr.match(/invalid selection/g)?.length).toBe(2);
  });

  it("returns null on EOF at the section prompt", async () => {
    const console = new TestConsole();
    // No responses queued → first ask returns null.
    const result = await selectInteractive([ROOT, WT_FEATURE], { console, useFzf: false });
    expect(result).toBeNull();
  });

  it("returns null on EOF at the destination prompt", async () => {
    const console = new TestConsole();
    console.queueResponses("1"); // pick section, then EOF on destination
    const result = await selectInteractive([ROOT, WT_FEATURE], { console, useFzf: false });
    expect(result).toBeNull();
  });

  it("aborts after too many invalid section attempts", async () => {
    const console = new TestConsole();
    console.queueResponses("x", "x", "x", "x", "x");
    const result = await selectInteractive([ROOT, WT_FEATURE], { console, useFzf: false });
    expect(result).toBeNull();
    expect(console.stderr).toContain("too many invalid section attempts");
  });
});

describe("selectInteractive fzf path (with injected runner)", () => {
  it("auto-skips the section picker when only one section exists and returns the chosen line", async () => {
    const console = new TestConsole();
    let calls = 0;
    const runFzf: FzfRunner = ({ args, input }) => {
      calls++;
      // Only the item picker should be invoked; the section picker is skipped.
      expect(args.some((a) => a.startsWith("--prompt=cdwt> "))).toBe(true);
      expect(input.split("\n")).toContain(renderLine(WT_FEATURE));
      return Promise.resolve({ exitCode: 0, stdout: `\n${renderLine(WT_FEATURE)}\n` });
    };
    const result = await selectInteractive([WT_FEATURE], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(calls).toBe(1);
    expect(result?.destination).toBe("/repo-feature");
  });

  it("flows through section picker → item picker and returns the picked line", async () => {
    const console = new TestConsole();
    const sequence: ("section" | "item")[] = [];
    const runFzf: FzfRunner = ({ args }) => {
      if (args.some((a) => a.startsWith("--prompt=section> "))) {
        sequence.push("section");
        return Promise.resolve({ exitCode: 0, stdout: `\n\nworktree (2)\n` });
      }
      sequence.push("item");
      return Promise.resolve({ exitCode: 0, stdout: `\n${renderLine(WT_BUGFIX)}\n` });
    };
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(sequence).toEqual(["section", "item"]);
    expect(result?.destination).toBe("/repo-bugfix");
  });

  it("escapes back to the section picker when the item picker returns esc", async () => {
    const console = new TestConsole();
    const calls: string[] = [];
    const runFzf: FzfRunner = ({ args }) => {
      const isSection = args.some((a) => a.startsWith("--prompt=section> "));
      calls.push(isSection ? "section" : "item");
      if (calls.length === 1) {
        // first section pick → worktree
        return Promise.resolve({ exitCode: 0, stdout: `\n\nworktree (2)\n` });
      }
      if (calls.length === 2) {
        // first item picker → esc back
        return Promise.resolve({ exitCode: 0, stdout: `esc\n` });
      }
      if (calls.length === 3) {
        // section picker again → root
        return Promise.resolve({ exitCode: 0, stdout: `\n\nroot (1)\n` });
      }
      // item picker for root → pick the only entry
      return Promise.resolve({ exitCode: 0, stdout: `\n${renderLine(ROOT)}\n` });
    };
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result?.destination).toBe("/repo");
    expect(calls).toEqual(["section", "item", "section", "item"]);
  });

  it("opens the cross-section search picker when the user types in the section picker", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = ({ args }) => {
      if (args.some((a) => a.startsWith("--prompt=section> "))) {
        // user typed "feature" in the section picker → triggers search mode
        return Promise.resolve({ exitCode: 0, stdout: `feature\n\n\n` });
      }
      // search picker returns a chosen line
      return Promise.resolve({
        exitCode: 0,
        stdout: `feature\n\n${renderSearchLine(WT_FEATURE)}\n`,
      });
    };
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result?.destination).toBe("/repo-feature");
  });

  it("returns null when the section picker is cancelled (esc + empty stdout)", async () => {
    const console = new TestConsole();
    const runFzf: FzfRunner = () => Promise.resolve({ exitCode: 130, stdout: "" });
    const result = await selectInteractive([ROOT, WT_FEATURE, WT_BUGFIX], {
      console,
      useFzf: true,
      fzfRunner: runFzf,
    });
    expect(result).toBeNull();
  });
});
