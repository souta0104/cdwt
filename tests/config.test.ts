import { describe, expect, it } from "vitest";
import { ConfigError, mergeConfigs, parseConfig } from "../src/core/config.js";

describe("parseConfig", () => {
  it("returns an empty config when copyIgnored is missing", () => {
    expect(parseConfig({})).toEqual({ copyIgnored: {} });
  });

  it("parses paths and patterns when both are present", () => {
    expect(
      parseConfig({
        copyIgnored: {
          paths: [".env", ".claude/settings.local.json"],
          patterns: ["*.local.json"],
        },
      }),
    ).toEqual({
      copyIgnored: {
        paths: [".env", ".claude/settings.local.json"],
        patterns: ["*.local.json"],
      },
    });
  });

  it("preserves an explicit empty array (distinct from missing)", () => {
    expect(parseConfig({ copyIgnored: { paths: [], patterns: ["a"] } })).toEqual({
      copyIgnored: { paths: [], patterns: ["a"] },
    });
  });

  it("rejects non-object roots", () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
    expect(() => parseConfig("oops")).toThrow(ConfigError);
    expect(() => parseConfig(null)).toThrow(ConfigError);
  });

  it("rejects non-string entries inside paths or patterns", () => {
    expect(() => parseConfig({ copyIgnored: { paths: [1] } })).toThrow(ConfigError);
    expect(() => parseConfig({ copyIgnored: { patterns: [{}] } })).toThrow(ConfigError);
  });

  it("rejects non-array paths/patterns", () => {
    expect(() => parseConfig({ copyIgnored: { paths: "x" } })).toThrow(ConfigError);
  });
});

describe("mergeConfigs", () => {
  it("later configs replace earlier values for keys they define", () => {
    const merged = mergeConfigs([
      { copyIgnored: { paths: ["a"], patterns: ["x"] } },
      { copyIgnored: { paths: ["b"] } },
    ]);
    expect(merged).toEqual({ copyIgnored: { paths: ["b"], patterns: ["x"] } });
  });

  it("missing keys leave earlier values intact", () => {
    const merged = mergeConfigs([
      { copyIgnored: { paths: ["keep"] } },
      { copyIgnored: { patterns: ["new"] } },
    ]);
    expect(merged).toEqual({ copyIgnored: { paths: ["keep"], patterns: ["new"] } });
  });

  it("an explicit empty array clears the inherited value", () => {
    const merged = mergeConfigs([
      { copyIgnored: { paths: ["keep"] } },
      { copyIgnored: { paths: [] } },
    ]);
    expect(merged).toEqual({ copyIgnored: { paths: [], patterns: [] } });
  });

  it("returns a fresh object on every call", () => {
    const a = mergeConfigs([{ copyIgnored: { paths: ["x"] } }]);
    const b = mergeConfigs([{ copyIgnored: { paths: ["x"] } }]);
    expect(a).not.toBe(b);
    expect(a.copyIgnored).not.toBe(b.copyIgnored);
  });
});
