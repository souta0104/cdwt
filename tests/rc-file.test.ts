import { describe, expect, it } from "vitest";
import { appendLineIfMissing } from "../src/core/rc-file.js";

const SOURCE = 'source "$HOME/.local/share/cdwt/cdwt.zsh"';

describe("appendLineIfMissing", () => {
  it("writes the line into an empty file with no leading blank", () => {
    const result = appendLineIfMissing("", SOURCE);
    expect(result.changed).toBe(true);
    expect(result.contents).toBe(`${SOURCE}\n`);
  });

  it("appends to a file ending in a newline without inserting an extra blank line", () => {
    const existing = "alias l='ls -la'\n";
    const result = appendLineIfMissing(existing, SOURCE);
    expect(result.changed).toBe(true);
    expect(result.contents).toBe(`${existing}${SOURCE}\n`);
  });

  it("adds a missing trailing newline before appending", () => {
    const existing = "alias l='ls -la'";
    const result = appendLineIfMissing(existing, SOURCE);
    expect(result.changed).toBe(true);
    expect(result.contents).toBe(`alias l='ls -la'\n${SOURCE}\n`);
  });

  it("is idempotent when the exact line already exists", () => {
    const existing = `# header\n${SOURCE}\nalias x='y'\n`;
    const result = appendLineIfMissing(existing, SOURCE);
    expect(result.changed).toBe(false);
    expect(result.contents).toBe(existing);
  });

  it("treats a line with surrounding whitespace as already present", () => {
    const existing = `   ${SOURCE}\t \nalias x='y'\n`;
    const result = appendLineIfMissing(existing, SOURCE);
    expect(result.changed).toBe(false);
    expect(result.contents).toBe(existing);
  });

  it("ignores blank input", () => {
    const result = appendLineIfMissing("alias a=b\n", "   ");
    expect(result.changed).toBe(false);
    expect(result.contents).toBe("alias a=b\n");
  });
});
