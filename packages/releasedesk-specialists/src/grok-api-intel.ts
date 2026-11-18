import {
  resolveAgentGrokApiKey,
  type MockMeta,
} from "@releasedesk/core";
import { grokComplete, type GrokClientOptions, type GrokCompleteResult } from "./grok.js";

/**
 * Shipped-code Grok API intel path for release findings.
 *
 * Uses the Builder's exclusive key (`RELEASEDESK_GROK_API_KEY_BUILDER`) via
 * `resolveAgentGrokApiKey('builder')` — never shared `XAI_API_KEY` / `GROK_API_KEY`.
 * Intended to run after Coding ships repo code, to classify / extract / score /
 * summarize findings for Lead consolidation.
 */

export type ReleaseFindingInput = {
  id?: string;
  sourceAgent?: string;
  summary: string;
  severity?: string;
  evidenceIds?: string[];
};

export type GrokIntelOptions = GrokClientOptions & {
  env?: NodeJS.ProcessEnv;
  /** Override role used for exclusive key resolve (default: builder). */
  role?: "builder" | "security";
};

export type GrokIntelResult = GrokCompleteResult & {
  /** Env var role used for the exclusive key lookup. */
  keyRole: "builder" | "security";
  mocked: boolean;
  mock?: MockMeta;
};

function resolveIntelApiKey(opts: GrokIntelOptions = {}): {
  apiKey: string | undefined;
  keyRole: "builder" | "security";
} {
  const keyRole = opts.role ?? "builder";
  const env = opts.env ?? process.env;
  // Explicit opts.apiKey wins; otherwise exclusive Builder (or Security) key only.
  const apiKey = opts.apiKey ?? resolveAgentGrokApiKey(keyRole, env);
  return { apiKey, keyRole };
}

function findingsBlock(findings: ReleaseFindingInput[]): string {
  return findings
    .map((f, i) => {
      const parts = [
        `${i + 1}. ${f.summary}`,
        f.sourceAgent ? `source=${f.sourceAgent}` : undefined,
        f.severity ? `severity=${f.severity}` : undefined,
        f.id ? `id=${f.id}` : undefined,
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

async function intelComplete(
  prompt: string,
  fallback: string,
  opts: GrokIntelOptions = {},
): Promise<GrokIntelResult> {
  const { apiKey, keyRole } = resolveIntelApiKey(opts);
  // Explicit apiKey from resolveAgentGrokApiKey(role) — never shared XAI/GROK keys.
  const result = await grokComplete(prompt, {
    ...opts,
    apiKey,
    agentRole: keyRole,
    fallback,
  });
  return { ...result, keyRole };
}

/** Classify findings into themes / buckets for Lead routing. */
export async function classifyReleaseFindings(
  findings: ReleaseFindingInput[],
  opts: GrokIntelOptions = {},
): Promise<GrokIntelResult> {
  const fallback = findings.length
    ? `Local classify: ${findings.length} finding(s) — ${findings
        .map((f) => f.severity ?? "unspecified")
        .join(", ")}`
    : "Local classify: no findings";
  return intelComplete(
    [
      "Classify these Release Desk findings into concise themes",
      "(security, standards, change-impact, process). One short line per theme.",
      "",
      findingsBlock(findings),
    ].join("\n"),
    fallback,
    opts,
  );
}

/** Extract actionable remediation items from findings. */
export async function extractReleaseActions(
  findings: ReleaseFindingInput[],
  opts: GrokIntelOptions = {},
): Promise<GrokIntelResult> {
  const fallback = findings.length
    ? `Local extract: remediate — ${findings.map((f) => f.summary).slice(0, 3).join("; ")}`
    : "Local extract: no actions";
  return intelComplete(
    [
      "Extract concrete remediation actions from these Release Desk findings.",
      "Return a short numbered list of actionable items only.",
      "",
      findingsBlock(findings),
    ].join("\n"),
    fallback,
    opts,
  );
}

/** Score overall release risk from findings (low / medium / high / critical). */
export async function scoreReleaseRisk(
  findings: ReleaseFindingInput[],
  opts: GrokIntelOptions = {},
): Promise<GrokIntelResult> {
  const hasBlocking = findings.some((f) =>
    /critical|high|block/i.test(`${f.severity ?? ""} ${f.summary}`),
  );
  const fallback = hasBlocking
    ? "Local score: high — blocking signals present"
    : findings.length
      ? "Local score: medium — findings present without clear blockers"
      : "Local score: low — no findings";
  return intelComplete(
    [
      "Score overall release risk from these findings as one of:",
      "low | medium | high | critical.",
      "Reply with the score word, then one short sentence of rationale.",
      "",
      findingsBlock(findings),
    ].join("\n"),
    fallback,
    opts,
  );
}

/** Summarize findings for Lead / human gate briefings. */
export async function summarizeReleaseFindings(
  findings: ReleaseFindingInput[],
  opts: GrokIntelOptions = {},
): Promise<GrokIntelResult> {
  const fallback = findings.length
    ? `Local summary: ${findings.length} finding(s). ${findings
        .slice(0, 2)
        .map((f) => f.summary)
        .join(" · ")}`
    : "Local summary: no release findings";
  return intelComplete(
    [
      "Summarize these Release Desk findings for a human merge/release gate.",
      "Keep under 120 words; evidence-oriented; no merge recommendation.",
      "",
      findingsBlock(findings),
    ].join("\n"),
    fallback,
    opts,
  );
}
