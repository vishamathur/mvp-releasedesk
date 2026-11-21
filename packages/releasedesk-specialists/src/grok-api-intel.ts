import {
  APP_GROK_API_KEY_ENV,
  resolveAppGrokApiKey,
  type MockMeta,
} from "@releasedesk/core";
import { grokComplete, type GrokClientOptions, type GrokCompleteResult } from "./grok.js";

/**
 * Specialist-side twin of the shipped Grok intel call.
 *
 * Uses the single app key (`XAI_API_KEY`) and json_schema. Per-bot
 * RELEASEDESK_GROK_API_KEY_* values are ignored. Desk does not orchestrate
 * this as a bot handoff; the Builder cloud agent ships the Desk module,
 * and this twin stays on the same key and schema.
 */

const INTEL_JSON_SCHEMA = {
  name: "release_intel_line",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
} as const;

export type ReleaseFindingInput = {
  id?: string;
  sourceAgent?: string;
  summary: string;
  severity?: string;
  evidenceIds?: string[];
};

export type GrokIntelOptions = GrokClientOptions & {
  env?: NodeJS.ProcessEnv;
};

export type GrokIntelResult = GrokCompleteResult & {
  /** App key name. Per-bot roles are not used. */
  keyRole: "app";
  keyEnv: typeof APP_GROK_API_KEY_ENV;
  mocked: boolean;
  mock?: MockMeta;
};

function resolveIntelApiKey(opts: GrokIntelOptions = {}): {
  apiKey: string | undefined;
} {
  const env = opts.env ?? process.env;
  const apiKey = opts.apiKey ?? resolveAppGrokApiKey(env);
  return { apiKey };
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
  const { apiKey } = resolveIntelApiKey(opts);
  const result = await grokComplete(prompt, {
    ...opts,
    apiKey,
    jsonSchema: INTEL_JSON_SCHEMA,
    fallback,
  });
  return { ...result, keyRole: "app", keyEnv: APP_GROK_API_KEY_ENV };
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
