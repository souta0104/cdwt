/**
 * Pure helper that decides what an rc file (e.g. ~/.zshrc) should look like
 * after we ensure `line` is sourced exactly once. Centralised so we can
 * unit-test the idempotency and trimming rules without touching the FS.
 */
export interface RcAppendResult {
  /** New file contents to write. Equals `existing` when no change is needed. */
  contents: string;
  /** Whether the file actually changed. */
  changed: boolean;
}

export function appendLineIfMissing(existing: string, line: string): RcAppendResult {
  const target = line.trim();
  if (target === "") return { contents: existing, changed: false };

  for (const rawLine of existing.split("\n")) {
    if (rawLine.trim() === target) {
      return { contents: existing, changed: false };
    }
  }

  if (existing === "") {
    return { contents: `${target}\n`, changed: true };
  }
  const separator = existing.endsWith("\n") ? "" : "\n";
  return { contents: `${existing}${separator}${target}\n`, changed: true };
}
