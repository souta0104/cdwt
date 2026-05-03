import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { copyPatternMatchesPath, validateCopyPath } from "../core/copy.js";
import type { CdwtConfig } from "../types.js";
import type { ConsoleIO } from "./console.js";
import { isGitIgnored, listIgnoredFiles } from "./git.js";

export interface CopyIgnoredOptions {
  source: string;
  destination: string;
  config: CdwtConfig;
  console: ConsoleIO;
}

/**
 * Copy ignored files from `source` to `destination` according to the merged
 * `copyIgnored` rules. Mirrors the bash `copy_configured_ignored_paths` flow:
 * explicit paths first, then pattern-matched ignored files.
 */
export async function copyConfiguredIgnoredPaths(options: CopyIgnoredOptions): Promise<void> {
  const { source, destination, config, console } = options;

  for (const relative of config.copyIgnored.paths) {
    validateCopyPath(relative);
    await copyOneIgnoredPath(source, destination, relative, console);
  }

  if (config.copyIgnored.patterns.length === 0) return;

  const ignored = await listIgnoredFiles(source);
  for (const relative of ignored) {
    if (copyPatternMatchesPath(relative, config.copyIgnored.patterns)) {
      await copyOneIgnoredPath(source, destination, relative, console);
    }
  }
}

async function copyOneIgnoredPath(
  source: string,
  destination: string,
  relative: string,
  console: ConsoleIO,
): Promise<void> {
  validateCopyPath(relative);
  const sourceItem = path.join(source, relative);
  const destinationItem = path.join(destination, relative);

  const sourceStat = await safeStat(sourceItem);
  if (!sourceStat) return;

  const ignored = await isGitIgnored(source, relative);
  if (!ignored) {
    console.errln(`cdwt: copy path is not ignored by git, skipping: ${relative}`);
    return;
  }

  // `cp` with recursive: true creates the destination root itself, so we
  // only need to ensure the *parent* directory exists for both file and
  // directory copies. Defaults: force overwrites, errorOnExist false,
  // verbatimSymlinks true (Node 22), which matches `cp -pR` closely enough
  // for our "carry .env / .claude across worktrees" use case.
  await mkdir(path.dirname(destinationItem), { recursive: true });
  await cp(sourceItem, destinationItem, {
    recursive: sourceStat.isDirectory(),
    preserveTimestamps: true,
    force: true,
  });
}

async function safeStat(target: string) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}
