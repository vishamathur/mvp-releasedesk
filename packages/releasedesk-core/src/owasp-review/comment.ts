/**
 * `## owasp-review v1` pull request comment.
 * Builder reads the hidden machine block. The comment never approves a merge.
 */
import { z } from "zod";
import { formatGrokTelemetryLine } from "../grok-telemetry.js";
import { OWASP_CONTROL_IDS } from "./catalogue.js";
import {
  OWASP_EXCEPTION_TYPES,
  OWASP_OUTCOMES,
  OWASP_REVIEW_SCHEMA,
  OWASP_REVIEW_STATUSES,
  OWASP_SEVERITIES,
  OWASP_VERDICTS,
  type OwaspReviewReport,
} from "./types.js";

export const OWASP_REVIEW_HEADING = "## owasp-review v1";
export const OWASP_REVIEW_MACHINE_OPEN = "<!-- owasp-review-json:v1";
export const OWASP_REVIEW_MACHINE_CLOSE = "-->";
export const OWASP_BUILDER_DISPUTE_OPEN = "<!-- owasp-builder-dispute:v1";
const MAX_COMMENT_CHARS = 60_000;

const FixSchema = z.object({
  what: z.string(),
  where: z.string(),
  why: z.string(),
  owaspId: z.string(),
});

const TelemetrySchema = z.object({
  requestedModel: z.string(),
  servedModel: z.string().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
  reasoningTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  cachedPromptTokens: z.number().nullable(),
  costInUsdTicks: z.number().nullable(),
  latencyMs: z.number(),
  estUsd: z.number().nullable(),
  estNote: z.string(),
  billedCostUsd: z.number().nullable(),
  billedNote: z.string(),
});

export const OwaspReviewReportSchema = z.object({
  schema: z.literal(OWASP_REVIEW_SCHEMA),
  heading: z.literal("owasp-review v1"),
  status: z.enum(OWASP_REVIEW_STATUSES),
  outcome: z.enum(OWASP_OUTCOMES),
  risk: z.enum(["assessed", "not_assessed"]),
  advisory: z.literal(true),
  humanGateStillRequired: z.literal(true),
  noAutoApprove: z.literal(true),
  keyEnvVar: z.string().nullable(),
  headSha: z.string().nullable(),
  priorHeadSha: z.string().nullable(),
  generatedAt: z.string(),
  repository: z.string(),
  pullRequest: z.number().nullable(),
  title: z.string(),
  docsOnly: z.boolean(),
  filesTotal: z.number(),
  filesSent: z.number(),
  diffTruncated: z.boolean(),
  selectedControlIds: z.array(z.enum(OWASP_CONTROL_IDS)),
  controls: z.array(
    z.object({
      id: z.enum(OWASP_CONTROL_IDS),
      name: z.string(),
      group: z.enum(["owasp-top-10-2021", "asvs-api", "owasp-llm-2023"]),
      verdict: z.enum(OWASP_VERDICTS),
      selected: z.boolean(),
      rules: z.array(z.string()),
      paths: z.array(z.string()),
      reason: z.string(),
      path: z.string().nullable(),
      line: z.number().nullable(),
      evidence: z.string(),
      severity: z.enum(OWASP_SEVERITIES).nullable(),
      confidence: z.number().nullable(),
      autoFixable: z.boolean().nullable(),
      suggestedFix: FixSchema.nullable(),
    }),
  ),
  failures: z.array(
    z.object({
      id: z.enum(OWASP_CONTROL_IDS),
      path: z.string(),
      line: z.number(),
      severity: z.enum(OWASP_SEVERITIES),
      evidence: z.string(),
      suggestedFix: FixSchema,
      autoFixable: z.boolean(),
    }),
  ),
  droppedUngrounded: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      line: z.number().nullable(),
      evidence: z.string(),
      severity: z.string(),
      reason: z.string(),
    }),
  ),
  exceptions: z.array(
    z.object({
      type: z.enum(OWASP_EXCEPTION_TYPES),
      controlId: z.string().nullable(),
      path: z.string().nullable(),
      line: z.number().nullable(),
      reason: z.string(),
    }),
  ),
  failureRounds: z.record(z.string(), z.number().int().nonnegative()),
  model: z.string().nullable(),
  requestedModel: z.string().nullable(),
  telemetry: TelemetrySchema.nullable(),
  error: z.string().optional(),
});

export function safeJsonForHtmlComment(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function sanitizeInline(text: string, max = 400): string {
  const flat = text
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/</g, "&lt;")
    .replace(/@/g, "@\u200b")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function outcomeLine(report: OwaspReviewReport): string {
  if (report.outcome === "auto-proceed") {
    return "No confirmed failures. Outcome: auto-proceed. This OWASP layer has no human step on this diff.";
  }
  if (report.outcome === "remediate") {
    return "Outcome: remediate. Builder applies each confirmed failure at its path:line, then this review runs again on the new head.";
  }
  if (report.outcome === "skipped") {
    return "Outcome: skipped. Risk was not assessed. A skipped review is not a pass and is not auto-proceed.";
  }
  return "Outcome: needs-human. A person looks at the exceptions. This is not a pass and it does not auto-proceed.";
}

export function renderOwaspReviewComment(report: OwaspReviewReport): string {
  const commit = report.headSha ? `\`${report.headSha.slice(0, 7)}\` (\`${report.headSha}\`)` : "unknown";
  const key = report.keyEnvVar ?? "none";
  const failures = report.failures.length
    ? report.failures
        .map((failure) => {
          const fix = sanitizeInline(failure.suggestedFix.what, 180);
          return `- **${failure.id}** \`${failure.path}:${failure.line}\` ${failure.severity}. Evidence: \`${sanitizeInline(failure.evidence, 160)}\`. Fix: ${fix}`;
        })
        .join("\n")
    : "_None._";
  const exceptions = report.exceptions.length
    ? report.exceptions
        .map((item) => {
          const where = item.path ? ` \`${item.path}${item.line ? `:${item.line}` : ""}\`` : "";
          const control = item.controlId ? ` ${item.controlId}` : "";
          return `- **${item.type}**${control}${where} — ${sanitizeInline(item.reason, 240)}`;
        })
        .join("\n")
    : "_None._";
  const footer = report.telemetry ? formatGrokTelemetryLine(report.telemetry) : "model telemetry not reported";
  const lines = [
    OWASP_REVIEW_HEADING,
    "",
    "Automated OWASP checklist for this pull request. Security checks the controls the diff can affect, suggests a fix for every confirmed failure, and Builder remediates those lines in the change. A human still types the security-compliance decision. This review does not approve a merge or a release.",
    "",
    `**Commit** ${commit} · **Status** ${report.status} · **Outcome** ${report.outcome} · **Risk** ${report.risk} · **Key** \`${key}\``,
    "",
    outcomeLine(report),
    "",
  ];
  if (report.error) {
    lines.push(`**Error:** ${sanitizeInline(report.error, 500)}`, "");
  }
  lines.push(
    "### Failures handed to Builder",
    failures,
    "",
    "### Exceptions",
    exceptions,
    "",
    "_Grok and this automation stay advisory. The human gates (security-compliance approval and release go/no-go) are unchanged._",
    "",
    `> ${footer}`,
    "",
    OWASP_REVIEW_MACHINE_OPEN,
    safeJsonForHtmlComment(report),
    OWASP_REVIEW_MACHINE_CLOSE,
  );
  const head = lines.join("\n");

  const details = [
    "",
    "<details><summary>Selected controls</summary>",
    "",
    report.controls
      .filter((control) => control.selected)
      .map((control) => `- **${control.id}** ${control.verdict} rules=${control.rules.join(",") || "-"} paths=${control.paths.join(",") || "-"}`)
      .join("\n") || "_No controls were assessed._",
    "",
    "</details>",
    "",
  ].join("\n");
  const full = `${head}\n${details}`;
  return full.length <= MAX_COMMENT_CHARS ? full : `${head}\n`;
}

export type ParsedOwaspReview =
  | { ok: true; report: OwaspReviewReport }
  | { ok: false; reason: string };

/** Read the machine block. A comment that is not this review is not a pass. */
export function parseOwaspReviewComment(body: string): ParsedOwaspReview {
  if (!body.trimStart().startsWith(OWASP_REVIEW_HEADING)) {
    return { ok: false, reason: "not an owasp-review v1 comment" };
  }
  const open = body.indexOf(OWASP_REVIEW_MACHINE_OPEN);
  if (open < 0) return { ok: false, reason: "machine block is missing" };
  const start = open + OWASP_REVIEW_MACHINE_OPEN.length;
  const end = body.indexOf(OWASP_REVIEW_MACHINE_CLOSE, start);
  if (end < 0) return { ok: false, reason: "machine block is not closed" };
  try {
    const parsed = OwaspReviewReportSchema.safeParse(JSON.parse(body.slice(start, end)));
    if (!parsed.success) return { ok: false, reason: "machine block failed schema validation" };
    return { ok: true, report: parsed.data };
  } catch {
    return { ok: false, reason: "machine block is not valid JSON" };
  }
}
