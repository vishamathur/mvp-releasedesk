/**
 * Unified-diff helpers for the OWASP review.
 * A FAIL is kept only when the path is a changed file, the line sits in a
 * changed hunk, and the evidence is a changed line in that hunk.
 */
import { estimateTokensFromText } from "../token-budget.js";
import type { DiffFile, OwaspDropped, OwaspSeverity } from "./types.js";

export const OWASP_DIFF_TOKEN_BUDGET = 32_000;
export const UNTRUSTED_BEGIN = "<<<<<UNTRUSTED-PR-DATA>>>>>";
export const UNTRUSTED_END = "<<<<<END-UNTRUSTED-PR-DATA>>>>>";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export type DiffLineKind = "add" | "del" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  newLine: number | null;
};

export type DiffHunk = {
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type AddedLine = {
  path: string;
  line: number;
  text: string;
};

export type GroundCandidate = {
  id: string;
  path: string;
  line: number | null;
  evidence: string;
  severity: string;
};

export type GroundedHit = {
  id: string;
  path: string;
  line: number;
  evidence: string;
  severity: OwaspSeverity;
};

/** Build a one-hunk patch from new-file lines. Line 1 is the first entry. */
export function addedPatch(lines: readonly string[]): string {
  const body = lines.map((line) => (line.startsWith("+") ? line : `+${line}`)).join("\n");
  const count = Math.max(lines.length, 1);
  return `@@ -0,0 +1,${count} @@\n${body}`;
}

/** Text of added and deleted lines, without the leading diff marker. */
export function changedTexts(patch: string): string[] {
  const texts: string[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+") || raw.startsWith("-")) texts.push(raw.slice(1));
  }
  return texts;
}

/** Parse a GitHub file patch into hunks with new-file line numbers. */
export function parseUnifiedHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      const newStart = Number(header[3]);
      const newCount = header[4] === undefined ? 1 : Number(header[4]);
      current = { newStart, newCount, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) current.lines.push({ kind: "add", text: raw.slice(1), newLine: null });
    else if (raw.startsWith("-")) current.lines.push({ kind: "del", text: raw.slice(1), newLine: null });
    else if (raw.startsWith(" ")) current.lines.push({ kind: "context", text: raw.slice(1), newLine: null });
    else if (raw === "") current.lines.push({ kind: "context", text: "", newLine: null });
  }
  for (const hunk of hunks) {
    let line = hunk.newStart;
    for (const entry of hunk.lines) {
      if (entry.kind === "del") {
        entry.newLine = null;
      } else {
        entry.newLine = line;
        line += 1;
      }
    }
  }
  return hunks;
}

export function addedLines(file: DiffFile): AddedLine[] {
  const lines: AddedLine[] = [];
  for (const hunk of parseUnifiedHunks(file.patch)) {
    for (const entry of hunk.lines) {
      if (entry.kind === "add" && entry.newLine !== null) {
        lines.push({ path: file.path, line: entry.newLine, text: entry.text });
      }
    }
  }
  return lines;
}

function hunkCoversLine(hunk: DiffHunk, line: number): boolean {
  if (hunk.newCount === 0) return line === hunk.newStart;
  return line >= hunk.newStart && line < hunk.newStart + hunk.newCount;
}

function normalizeEvidence(evidence: string): string {
  let text = evidence.trim();
  if ((text.startsWith("+") || text.startsWith("-")) && text.length > 1) text = text.slice(1).trim();
  return text;
}

function evidenceOnChangedLine(line: string, evidence: string): boolean {
  if (!evidence) return false;
  const trimmed = line.trim();
  if (trimmed === evidence) return true;
  if (evidence.length < 8) return false;
  return line.includes(evidence);
}

const SEVERITIES = new Set<OwaspSeverity>(["low", "medium", "high", "critical"]);

/**
 * Keep findings the diff supports. Anything else is dropped and is not a PASS.
 * Ids are whatever the caller cited; they are not read from a pull request title.
 */
export function partitionGrounded(
  candidates: readonly GroundCandidate[],
  files: readonly DiffFile[],
): { grounded: GroundedHit[]; dropped: OwaspDropped[] } {
  const grounded: GroundedHit[] = [];
  const dropped: OwaspDropped[] = [];
  const hunksByPath = new Map(files.map((file) => [file.path, parseUnifiedHunks(file.patch)]));
  const known = new Set(files.map((file) => file.path));
  const seen = new Set<string>();

  for (const item of candidates) {
    const path = item.path.trim();
    const line = item.line;
    const evidence = normalizeEvidence(item.evidence);
    const severity = item.severity;
    if (!item.id || !path || line === null || line < 1 || !evidence || !SEVERITIES.has(severity as OwaspSeverity)) {
      dropped.push({
        id: item.id,
        path,
        line,
        evidence,
        severity,
        reason: "finding is missing id, path, line, evidence, or severity",
      });
      continue;
    }
    if (!known.has(path)) {
      dropped.push({ id: item.id, path, line, evidence, severity, reason: "path is not a changed file" });
      continue;
    }
    const hunks = hunksByPath.get(path) ?? [];
    const hunk = hunks.find((entry) => hunkCoversLine(entry, line));
    if (!hunk) {
      dropped.push({ id: item.id, path, line, evidence, severity, reason: "line is not inside a changed hunk" });
      continue;
    }
    const changed = hunk.lines.filter((entry) => entry.kind === "add" || entry.kind === "del");
    if (!changed.some((entry) => evidenceOnChangedLine(entry.text, evidence))) {
      dropped.push({
        id: item.id,
        path,
        line,
        evidence,
        severity,
        reason: "evidence does not appear on a changed line in that hunk",
      });
      continue;
    }
    const key = `${item.id}:${path}:${line}:${evidence}:${severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grounded.push({ id: item.id, path, line, evidence, severity: severity as OwaspSeverity });
  }
  return { grounded, dropped };
}

export type NumberedDiff = {
  text: string;
  filesSent: number;
  filesTotal: number;
  truncated: boolean;
  tokenBudget: number;
};

function fileBody(file: DiffFile): string {
  const hunks = parseUnifiedHunks(file.patch);
  const lines: string[] = [`diff --git a/${file.path} b/${file.path}`];
  if (hunks.length === 0) {
    lines.push("# GitHub omitted the patch for this file");
    return lines.join("\n");
  }
  for (const hunk of hunks) {
    lines.push(`@@ +${hunk.newStart},${hunk.newCount} @@`);
    for (const entry of hunk.lines) {
      if (entry.kind === "add" && entry.newLine !== null) lines.push(`L${entry.newLine}: ${entry.text}`);
      else if (entry.kind === "del") lines.push(`- ${entry.text}`);
      else if (entry.newLine !== null) lines.push(`C${entry.newLine}: ${entry.text}`);
    }
  }
  return lines.join("\n");
}

function prefixWithinTokens(text: string, tokenBudget: number): string {
  if (estimateTokensFromText(text) <= tokenBudget) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokensFromText(text.slice(0, mid)) <= tokenBudget) low = mid;
    else high = mid - 1;
  }
  const sliced = text.slice(0, low);
  const newline = sliced.lastIndexOf("\n");
  return newline > 0 ? sliced.slice(0, newline + 1) : sliced;
}

/** Keep whole files until the token budget is spent. The last file may be cut. */
export function renderNumberedDiff(files: readonly DiffFile[], tokenBudget: number): NumberedDiff {
  const parts: string[] = [];
  let tokensUsed = 0;
  let truncated = false;
  let filesSent = 0;
  for (const file of files) {
    const body = `${fileBody(file)}\n`;
    const cost = estimateTokensFromText(body);
    if (tokensUsed + cost <= tokenBudget) {
      parts.push(body);
      tokensUsed += cost;
      filesSent += 1;
      continue;
    }
    const remaining = tokenBudget - tokensUsed;
    if (remaining >= 32) {
      const partial = prefixWithinTokens(body, remaining);
      if (partial.trim()) {
        parts.push(partial);
        filesSent += 1;
      }
    }
    truncated = true;
    break;
  }
  if (filesSent < files.length) truncated = true;
  return {
    text: parts.join("\n"),
    filesSent,
    filesTotal: files.length,
    truncated,
    tokenBudget,
  };
}

export function neutralizeUntrustedMarkers(text: string): string {
  return text.split(UNTRUSTED_BEGIN).join("[untrusted-marker]").split(UNTRUSTED_END).join("[untrusted-marker]");
}

export function resolveOwaspDiffTokenBudget(env: Record<string, string | undefined>): number {
  const raw = env.OWASP_REVIEW_DIFF_TOKEN_BUDGET?.trim();
  if (!raw) return OWASP_DIFF_TOKEN_BUDGET;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 256) {
    throw new Error("OWASP_REVIEW_DIFF_TOKEN_BUDGET must be an integer of at least 256");
  }
  return value;
}
