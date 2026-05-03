import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { CdwtError } from "../errors.js";
import { ConfigError, mergeConfigs, parseConfig, type ParsedConfig } from "../core/config.js";
import type { CdwtConfig } from "../types.js";

export interface DiscoverConfigsInput {
  /** Real (resolved) cwd. */
  cwd: string;
  mainWorktree: string;
  /** Process HOME directory. */
  home: string;
  /** Optional CDWT_CONFIG env override. */
  override?: string | undefined;
}

/**
 * Locate config files in weak-to-strong order. The list returned is suitable
 * to feed into `parseConfig` + `mergeConfigs`. Mirrors the bash discovery rules:
 *   - if CDWT_CONFIG is set, only that file is read (and its absence is a hard
 *     error)
 *   - otherwise: $HOME/.cdwt/settings.json, then `.cdwt/settings.json` files
 *     walking from filesystem root down to the cwd (or the main worktree, when
 *     cwd is outside the main worktree).
 */
export async function discoverConfigFiles({
  cwd,
  mainWorktree,
  home,
  override,
}: DiscoverConfigsInput): Promise<string[]> {
  if (override !== undefined) {
    if (!(await fileExists(override))) {
      throw new CdwtError(`config file not found: ${override}`);
    }
    return [override];
  }

  const seen = new Set<string>();
  const files: string[] = [];

  const homeFile = path.join(home, ".cdwt", "settings.json");
  if (await fileExists(homeFile)) {
    seen.add(homeFile);
    files.push(homeFile);
  }

  let scan = cwd;
  if (scan !== mainWorktree && !scan.startsWith(`${mainWorktree}/`)) {
    scan = mainWorktree;
  }
  const dirs: string[] = [];
  while (true) {
    dirs.push(scan);
    if (scan === "/" || scan === "") break;
    scan = path.dirname(scan);
  }
  // bash walks from root → cwd (weak → strong)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const file = path.join(dirs[i]!, ".cdwt", "settings.json");
    if (seen.has(file)) continue;
    if (await fileExists(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

export async function readMergedConfig(files: readonly string[]): Promise<CdwtConfig> {
  const parsed: ParsedConfig[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      throw new CdwtError(`failed to read config: ${file} (${(err as Error).message})`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new CdwtError(`invalid JSON in ${file}: ${(err as Error).message}`);
    }
    try {
      parsed.push(parseConfig(json, file));
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new CdwtError(`invalid config: ${file} (${err.message})`);
      }
      throw err;
    }
  }
  return mergeConfigs(parsed);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}
