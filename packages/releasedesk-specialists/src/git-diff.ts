import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMockMeta, formatMockNote, type MockMeta } from "@releasedesk/core";

const execFileAsync = promisify(execFile);

export type GitNameStatus = {
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U" | "?";
  path: string;
  newPath?: string;
};

export type GitCommitSummary = {
  sha: string;
  subject: string;
};

export type LocalDiffResult = {
  commits: GitCommitSummary[];
  files: GitNameStatus[];
  rawNameStatus: string;
  mocked: boolean;
  mocksUsed: MockMeta[];
  source: "git" | "fixture";
};

function mapChangeType(
  status: GitNameStatus["status"],
): "added" | "modified" | "deleted" | "renamed" | "unknown" {
  switch (status) {
    case "A":
      return "added";
    case "M":
    case "T":
      return "modified";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    default:
      return "unknown";
  }
}

export { mapChangeType };

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ok: true, stdout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function parseNameStatus(raw: string): GitNameStatus[] {
  const files: GitNameStatus[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const code = (parts[0] ?? "?").charAt(0) as GitNameStatus["status"];
    if (parts.length >= 3 && (code === "R" || code === "C")) {
      files.push({ status: code, path: parts[1]!, newPath: parts[2] });
      continue;
    }
    if (parts.length >= 2) {
      files.push({ status: code, path: parts[1]! });
    }
  }
  return files;
}

function parseLog(raw: string): GitCommitSummary[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(" ");
      if (idx < 0) return { sha: line, subject: "" };
      return { sha: line.slice(0, idx), subject: line.slice(idx + 1) };
    });
}

/**
 * Inspect local git range `baseRef...headRef`.
 * On failure, returns an empty file list. The caller must not invent a change set.
 */
export async function collectLocalDiff(opts: {
  cwd: string;
  baseRef: string;
  headRef: string;
}): Promise<LocalDiffResult> {
  const mocksUsed: MockMeta[] = [];
  const range = `${opts.baseRef}...${opts.headRef}`;

  const nameStatus = await runGit(opts.cwd, ["diff", "--name-status", range]);
  const log = await runGit(opts.cwd, ["log", "--pretty=format:%h %s", range]);

  if (!nameStatus.ok) {
    const mock = createMockMeta(
      "git-diff",
      `git diff failed (${nameStatus.error}); caller should use fixtures`,
    );
    mocksUsed.push(mock);
    return {
      commits: [],
      files: [],
      rawNameStatus: "",
      mocked: true,
      mocksUsed,
      source: "fixture",
    };
  }

  const commits = log.ok ? parseLog(log.stdout) : [];
  if (!log.ok) {
    mocksUsed.push(
      createMockMeta("git-log", formatMockNote(`git log failed: ${log.error}`)),
    );
  }

  return {
    commits,
    files: parseNameStatus(nameStatus.stdout),
    rawNameStatus: nameStatus.stdout,
    mocked: mocksUsed.length > 0,
    mocksUsed,
    source: "git",
  };
}

/** Heuristic impact for a changed path. */
export function impactForPath(filePath: string): "low" | "medium" | "high" {
  const p = filePath.toLowerCase();
  if (
    p.includes("security") ||
    p.includes("auth") ||
    p.includes("secret") ||
    p.includes("crypto") ||
    p.endsWith("lock") ||
    p.includes("dockerfile")
  ) {
    return "high";
  }
  if (
    p.startsWith("apps/kyc") ||
    p.includes("risk") ||
    p.includes("policy") ||
    p.includes("releasedesk")
  ) {
    return "medium";
  }
  if (p.endsWith(".md") || p.includes("readme") || p.includes("docs/")) {
    return "low";
  }
  return "medium";
}

export function overallImpactFromFindings(
  impacts: Array<"low" | "medium" | "high" | "unknown">,
): "low" | "medium" | "high" | "unknown" {
  if (impacts.length === 0) return "low";
  if (impacts.includes("high")) return "high";
  if (impacts.includes("medium")) return "medium";
  if (impacts.every((i) => i === "low")) return "low";
  return "unknown";
}
