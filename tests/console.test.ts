import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createDefaultConsole } from "../src/io/console.js";
import { TestConsole } from "../src/io/test-console.js";

describe("TestConsole", () => {
  it("buffers stdout and stderr separately", () => {
    const console = new TestConsole();
    console.out("partial ");
    console.outln("line");
    console.errln("error one");
    console.err("warn ");
    console.errln("two");
    expect(console.stdout).toBe("partial line\n");
    expect(console.stderr).toBe("error one\nwarn two\n");
  });

  it("answers ask from the queue and returns null when exhausted", async () => {
    const console = new TestConsole();
    console.queueResponses("first", "second");
    expect(await console.ask("a> ")).toBe("first");
    expect(await console.ask("b> ")).toBe("second");
    expect(await console.ask("c> ")).toBeNull();
  });

  it("treats null answers and non-y replies as confirm=false", async () => {
    const console = new TestConsole();
    expect(await console.confirm("?")).toBe(false);
    console.queueResponses("n");
    expect(await console.confirm("?")).toBe(false);
    console.queueResponses("yes");
    expect(await console.confirm("?")).toBe(true);
    console.queueResponses("Y");
    expect(await console.confirm("?")).toBe(true);
  });
});

describe("createDefaultConsole", () => {
  it("returns null from ask when stdin is not a TTY (no blocking)", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    // no isTTY assigned -> falsy
    const console = createDefaultConsole({ stdin, stdout, stderr });
    expect(console.isInteractive).toBe(false);
    expect(await console.ask("? ")).toBeNull();
    expect(await console.confirm("? ")).toBe(false);
  });

  it("writes to the provided stdout/stderr streams", () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    let outChunks = "";
    let errChunks = "";
    stdout.on("data", (c: Buffer) => (outChunks += c.toString("utf8")));
    stderr.on("data", (c: Buffer) => (errChunks += c.toString("utf8")));
    const console = createDefaultConsole({ stdin, stdout, stderr });
    console.outln("hello");
    console.errln("warn");
    expect(outChunks).toBe("hello\n");
    expect(errChunks).toBe("warn\n");
  });
});
