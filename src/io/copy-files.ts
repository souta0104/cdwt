import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { copyPatternMatchesPath, patternsToPathspecs, validateCopyPath } from "../core/copy.js";
import type { CdwtConfig } from "../types.js";
import type { ConsoleIO } from "./console.js";
import { isGitIgnored, listIgnoredFilesMatching } from "./git.js";

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
  const t0Total = Date.now();

  console.debug(
    `copyConfiguredIgnoredPaths start source=${source} destination=${destination} paths=[${config.copyIgnored.paths.join(",")}] patterns=[${config.copyIgnored.patterns.join(",")}]`,
  );

  let timeInIsIgnored = 0;
  let timeInCp = 0;
  let copiedCount = 0;
  let skippedCount = 0;

  for (const relative of config.copyIgnored.paths) {
    validateCopyPath(relative);
    await copyOneIgnoredPath(source, destination, relative, console, {
      onTimeIgnored: (ms) => { timeInIsIgnored += ms; },
      onTimeCp: (ms) => { timeInCp += ms; },
      onCopied: () => { copiedCount++; },
      onSkipped: () => { skippedCount++; },
    });
  }

  if (config.copyIgnored.patterns.length === 0) {
    console.debug(
      `copyConfiguredIgnoredPaths done (no patterns) elapsed=${Date.now() - t0Total}ms copied=${copiedCount} skipped=${skippedCount}`,
    );
    return;
  }

  const pathspecs = patternsToPathspecs(config.copyIgnored.patterns);
  const t0Ls = Date.now();
  const ignored = await listIgnoredFilesMatching(source, pathspecs);
  const lsElapsed = Date.now() - t0Ls;
  console.debug(`git ls-files (targeted) returned ${ignored.length} entries in ${lsElapsed}ms`);

  const matched = ignored.filter((f) => copyPatternMatchesPath(f, config.copyIgnored.patterns));
  console.debug(`pattern filter: ${matched.length} of ${ignored.length} entries matched`);

  for (const relative of matched) {
    await copyOnePath(source, destination, relative, console, {
      onTimeCp: (ms) => { timeInCp += ms; },
      onCopied: () => { copiedCount++; },
    });
  }

  const totalElapsed = Date.now() - t0Total;
  console.debug(
    `copyConfiguredIgnoredPaths done elapsed=${totalElapsed}ms copied=${copiedCount} skipped=${skippedCount} timeInIsIgnored=${timeInIsIgnored}ms timeInCp=${timeInCp}ms other=${totalElapsed - timeInIsIgnored - timeInCp}ms`,
  );
}

interface CopyTimers {
  onTimeIgnored: (ms: number) => void;
  onTimeCp: (ms: number) => void;
  onCopied: () => void;
  onSkipped: () => void;
}

async function copyOneIgnoredPath(
  source: string,
  destination: string,
  relative: string,
  console: ConsoleIO,
  timers: CopyTimers,
): Promise<void> {
  validateCopyPath(relative);
  const sourceItem = path.join(source, relative);
  const destinationItem = path.join(destination, relative);

  const sourceStat = await safeStat(sourceItem);
  if (!sourceStat) {
    console.debug(`copy skip (not found): ${relative}`);
    return;
  }

  const t0Ignored = Date.now();
  const ignored = await isGitIgnored(source, relative);
  const ignoredElapsed = Date.now() - t0Ignored;
  timers.onTimeIgnored(ignoredElapsed);

  if (!ignored) {
    console.debug(`copy skip (not git-ignored, isGitIgnored took ${ignoredElapsed}ms): ${relative}`);
    timers.onSkipped();
    console.errln(`cdwt: copy path is not ignored by git, skipping: ${relative}`);
    return;
  }

  const sizeInfo = sourceStat.isDirectory() ? "dir" : `${sourceStat.size}B`;
  console.debug(
    `copy ${relative} (${sizeInfo}) isGitIgnored=${ignoredElapsed}ms`,
  );

  // `cp` with recursive: true creates the destination root itself, so we
  // only need to ensure the *parent* directory exists for both file and
  // directory copies. Defaults: force overwrites, errorOnExist false,
  // verbatimSymlinks true (Node 22), which matches `cp -pR` closely enough
  // for our "carry .env / .claude across worktrees" use case.
  await mkdir(path.dirname(destinationItem), { recursive: true });

  const t0Cp = Date.now();
  await cp(sourceItem, destinationItem, {
    recursive: sourceStat.isDirectory(),
    preserveTimestamps: true,
    force: true,
  });
  const cpElapsed = Date.now() - t0Cp;
  timers.onTimeCp(cpElapsed);
  timers.onCopied();
  console.debug(`copy done ${relative} cp=${cpElapsed}ms`);
}

interface CopyOneTimers {
  onTimeCp: (ms: number) => void;
  onCopied: () => void;
}

async function copyOnePath(
  source: string,
  destination: string,
  relative: string,
  console: ConsoleIO,
  timers: CopyOneTimers,
): Promise<void> {
  validateCopyPath(relative);
  const sourceItem = path.join(source, relative);
  const destinationItem = path.join(destination, relative);

  const sourceStat = await safeStat(sourceItem);
  if (!sourceStat) {
    console.debug(`copy skip (not found): ${relative}`);
    return;
  }

  const sizeInfo = sourceStat.isDirectory() ? "dir" : `${sourceStat.size}B`;
  console.debug(`copy ${relative} (${sizeInfo})`);

  await mkdir(path.dirname(destinationItem), { recursive: true });

  const t0Cp = Date.now();
  await cp(sourceItem, destinationItem, {
    recursive: sourceStat.isDirectory(),
    preserveTimestamps: true,
    force: true,
  });
  const cpElapsed = Date.now() - t0Cp;
  timers.onTimeCp(cpElapsed);
  timers.onCopied();
  console.debug(`copy done ${relative} cp=${cpElapsed}ms`);
}

async function safeStat(target: string) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}
