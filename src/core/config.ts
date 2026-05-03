import type { CdwtConfig } from "../types.js";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * A parsed config preserves the distinction between "key absent" (don't override)
 * and "key present with empty array" (clear the inherited value), which the bash
 * version inherits from jq's `*` (recursive merge) operator.
 */
export interface ParsedConfig {
  copyIgnored: {
    paths?: string[];
    patterns?: string[];
  };
}

export function emptyConfig(): CdwtConfig {
  return { copyIgnored: { paths: [], patterns: [] } };
}

/**
 * Parse and validate the JSON contents of a single `.cdwt/settings.json` file.
 * Mirrors the bash jq schema check.
 */
export function parseConfig(json: unknown, file?: string): ParsedConfig {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new ConfigError("config root must be an object", file);
  }
  const root = json as Record<string, unknown>;
  const copyRaw = root["copyIgnored"];
  if (copyRaw === undefined) {
    return { copyIgnored: {} };
  }
  if (copyRaw === null || typeof copyRaw !== "object" || Array.isArray(copyRaw)) {
    throw new ConfigError("copyIgnored must be an object", file);
  }
  const copy = copyRaw as Record<string, unknown>;
  const out: ParsedConfig = { copyIgnored: {} };
  if ("paths" in copy) {
    out.copyIgnored.paths = readStringArray(copy["paths"], "copyIgnored.paths", file);
  }
  if ("patterns" in copy) {
    out.copyIgnored.patterns = readStringArray(copy["patterns"], "copyIgnored.patterns", file);
  }
  return out;
}

function readStringArray(value: unknown, key: string, file: string | undefined): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${key} must be an array`, file);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ConfigError(`${key} must contain only strings`, file);
    }
  }
  return [...(value as string[])];
}

/**
 * Merge configs in weak-to-strong order, mirroring jq's `*` (recursive merge):
 * later arrays REPLACE earlier ones; missing keys leave the earlier value intact.
 */
export function mergeConfigs(configs: readonly ParsedConfig[]): CdwtConfig {
  const merged = emptyConfig();
  for (const config of configs) {
    if (config.copyIgnored.paths !== undefined) {
      merged.copyIgnored.paths = [...config.copyIgnored.paths];
    }
    if (config.copyIgnored.patterns !== undefined) {
      merged.copyIgnored.patterns = [...config.copyIgnored.patterns];
    }
  }
  return merged;
}
