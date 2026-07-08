import type { PullRequest } from "../types.js";
import { run } from "./exec.js";

export async function isGhAvailable(): Promise<boolean> {
  const result = await run("which", ["gh"]);
  return result.exitCode === 0;
}

interface GhPrItem {
  number: number;
  title: string;
  headRefName: string;
  author: { login: string };
  assignees: { login: string }[];
}

/**
 * List open PRs for the current repository. Returns an empty list if `gh`
 * exits with a non-zero status (which is what the bash version did via
 * `2>/dev/null`).
 */
export async function listPullRequests(cwd: string, limit = 100): Promise<PullRequest[]> {
  const result = await run(
    "gh",
    [
      "pr",
      "list",
      "--limit",
      String(limit),
      "--json",
      "number,title,headRefName,author,assignees",
    ],
    { cwd },
  );
  if (result.exitCode !== 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PullRequest[] = [];
  for (const item of parsed) {
    if (!isGhPrItem(item)) continue;
    out.push({
      number: item.number,
      branch: item.headRefName,
      title: item.title,
      author: item.author.login,
      assignees: item.assignees.map((a) => a.login),
    });
  }
  return out;
}

export async function checkoutPr(cwd: string, prNumber: number): Promise<boolean> {
  const result = await run("gh", ["pr", "checkout", String(prNumber)], {
    cwd,
    inheritStdio: true,
  });
  return result.exitCode === 0;
}

/**
 * Resolve a PR number to its head branch name via `gh pr view`. Returns
 * `null` on any failure (gh missing, non-zero exit, malformed JSON) so
 * callers can fall back to their own handling.
 */
export async function getPrHeadBranch(cwd: string, prNumber: number): Promise<string | null> {
  const result = await run("gh", ["pr", "view", String(prNumber), "--json", "headRefName"], {
    cwd,
  }).catch(() => null);
  if (result === null || result.exitCode !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const headRefName = (parsed as Record<string, unknown>)["headRefName"];
  return typeof headRefName === "string" ? headRefName : null;
}

function isGhPrItem(value: unknown): value is GhPrItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v["number"] !== "number" ||
    typeof v["title"] !== "string" ||
    typeof v["headRefName"] !== "string"
  ) {
    return false;
  }
  if (!hasLogin(v["author"])) return false;
  const assignees = v["assignees"];
  return Array.isArray(assignees) && assignees.every(hasLogin);
}

function hasLogin(value: unknown): value is { login: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["login"] === "string"
  );
}
