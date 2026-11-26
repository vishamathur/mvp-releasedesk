/**
 * Render and read the `## release-intel v1` PR comment.
 *
 * The comment has three parts:
 *   1. a short human summary and one telemetry footer line,
 *   2. a hidden machine block:  <!-- release-intel-json:v1 ... -->
 *   3. a collapsed copy of the full report.
 *
 * Builder reads part 2 (or, for comments written before this format, the first
 * ```json fence), compares `headSha` with the PR head, and puts the fields in its
 * build-result. Nothing here approves or blocks anything: Grok output is advisory.
 */
import { formatGrokTelemetryLine } from "@releasedesk/core";
import type { ReleaseIntelPrReport } from "./release-intel-pr";

export const RELEASE_INTEL_HEADING = "## release-intel v1";
export const RELEASE_INTEL_MACHINE_OPEN = "<!-- release-intel-json:v1";
export const RELEASE_INTEL_MACHINE_CLOSE = "-->";
/** GitHub rejects comments over 65536 characters. Leave headroom. */
const MAX_COMMENT_CHARS = 60_000;

/** The compact, machine-readable view of a report. Drops the file list and the raw model preview. */
export function toMachineReport(report: ReleaseIntelPrReport): Record<string, unknown> {
  const { changedPaths: _changedPaths, intel, ...rest } = report;
  const { rawPreview: _rawPreview, ...intelRest } = intel;
  return { ...rest, intel: intelRest };
}

/** JSON that cannot close an HTML comment or inject markup: < > & are written as \uXXXX escapes. */
export function safeJsonForHtmlComment(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** Model text shown inline: one line, no backticks or tags, no live @-mentions, capped. */
export function sanitizeInline(text: string, max = 400): string {
  const flat = text
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/</g, "&lt;")
    .replace(/@/g, "@\u200b")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function renderReleaseIntelComment(report: ReleaseIntelPrReport): string {
  const { intel } = report;
  const commit = report.headSha
    ? `\`${report.headSha.slice(0, 7)}\` (\`${report.headSha}\`)`
    : "unknown (PR_HEAD_SHA was not set and GitHub did not return a head commit)";
  const blockers = intel.blockers.length
    ? intel.blockers.map((b) => `\`${sanitizeInline(b, 120).replace(/'/g, "")}\``).join(", ")
    : "none";
  const footer = formatGrokTelemetryLine(intel.telemetry);
  const head = [
    RELEASE_INTEL_HEADING,
    "",
    `**Commit** ${commit} · **risk** ${intel.riskTier} · **score** ${intel.score.level} · **${intel.label}**`,
    "",
    `**Grok blockers (advisory):** ${blockers}`,
    "",
    sanitizeInline(intel.summarize),
    "",
    "_Advisory only. Grok never approves a merge or a release. The Security gate and the human gates stay in force._",
    "",
    `> ${footer}`,
    "",
    RELEASE_INTEL_MACHINE_OPEN,
    safeJsonForHtmlComment(toMachineReport(report)),
    RELEASE_INTEL_MACHINE_CLOSE,
  ].join("\n");

  const details = [
    "",
    "<details><summary>Full report</summary>",
    "",
    "```json",
    JSON.stringify(report, null, 2).replace(/```/g, "'''"),
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
  const full = `${head}\n${details}`;
  return full.length <= MAX_COMMENT_CHARS ? full : `${head}\n`;
}

export type ParsedReleaseIntel =
  | { ok: true; source: "machine-block" | "json-fence"; report: Record<string, unknown> }
  | { ok: false; reason: string };

/** Read the report from a comment body. Prefers the hidden block, falls back to the first json fence. */
export function parseReleaseIntelComment(body: string): ParsedReleaseIntel {
  if (!body.trimStart().startsWith(RELEASE_INTEL_HEADING)) {
    return { ok: false, reason: "not a release-intel v1 comment" };
  }
  const open = body.indexOf(RELEASE_INTEL_MACHINE_OPEN);
  if (open >= 0) {
    const start = open + RELEASE_INTEL_MACHINE_OPEN.length;
    const end = body.indexOf(RELEASE_INTEL_MACHINE_CLOSE, start);
    if (end < 0) return { ok: false, reason: "machine block is not closed" };
    try {
      const report = JSON.parse(body.slice(start, end)) as Record<string, unknown>;
      return { ok: true, source: "machine-block", report };
    } catch {
      return { ok: false, reason: "machine block is not valid JSON" };
    }
  }
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(body);
  if (fence?.[1]) {
    try {
      const report = JSON.parse(fence[1]) as Record<string, unknown>;
      return { ok: true, source: "json-fence", report };
    } catch {
      return { ok: false, reason: "json fence is not valid JSON" };
    }
  }
  return { ok: false, reason: "no machine block or json fence in the comment" };
}

export type ReleaseIntelShaMatch =
  | { status: "match" }
  | { status: "mismatch"; reportSha: string; prSha: string }
  | { status: "unverifiable"; reason: string };

/** Is this report about the PR head commit? A report with no headSha is unverifiable, never a match. */
export function matchReleaseIntelSha(
  report: Record<string, unknown>,
  prHeadSha: string,
): ReleaseIntelShaMatch {
  const sha = typeof report.headSha === "string" ? report.headSha.toLowerCase() : "";
  if (!sha) return { status: "unverifiable", reason: "the report has no headSha" };
  const pr = prHeadSha.trim().toLowerCase();
  if (!pr) return { status: "unverifiable", reason: "the PR head sha was not supplied" };
  return sha === pr ? { status: "match" } : { status: "mismatch", reportSha: sha, prSha: pr };
}
