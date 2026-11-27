/**
 * Grok API release intel — shipped Desk module (classify + extract + score + summarize).
 *
 * Live key: RELEASEDESK_GROK_API_KEY_LEAD only.
 * Shared XAI_API_KEY / GROK_API_KEY are never consulted.
 * Absent key throws MissingCredentialError. There is no stand-in result.
 *
 * Specialist ship twin: packages/releasedesk-specialists/src/grok-api-intel.ts
 * (Builder exclusive key) — Cursor Coding agent hardens both.
 */

import {
  assertGrokChatStatus,
  buildGrokChatCompletionBody,
  buildGrokTelemetry,
  GROK_API_KEY_ENV,
  GROK_CHAT_COMPLETIONS_URL,
  GROK_REQUEST_TIMEOUT_MS,
  GrokGuidelineError,
  MissingCredentialError,
  resolveAgentGrokApiKey,
  resolveGrokModel,
  type GrokTelemetry,
} from "@releasedesk/core";

export type GrokIntelMode = "live";

export type GrokReleaseIntelInput = {
  repository: string;
  goal: string;
  findings: Array<{ source: string; text: string; severity?: string }>;
  /** Pull request number, when this call is about one. Used only as a stable cache key. */
  pullRequest?: number | null;
};

/** Stable across re-runs of the same repo (and PR). Not a secret. */
export function releaseIntelPromptCacheKey(repository: string, pullRequest?: number | null): string {
  const repo = repository.trim() || "unknown";
  const pr =
    typeof pullRequest === "number" && Number.isInteger(pullRequest) && pullRequest > 0
      ? `:pr:${pullRequest}`
      : "";
  return `release-intel:v2:${repo}${pr}`;
}

export type GrokIntelTrustCheck = {
  schemaValid: boolean;
  humanGateStillRequired: true;
  noAutoApprove: true;
  keyEnvVar: string;
  usedSharedFallback: false;
  notes: string[];
};

export type GrokReleaseIntelResult = {
  mode: GrokIntelMode;
  label: "LIVE";
  /** Whether RELEASEDESK_GROK_API_KEY_LEAD was present for this call. */
  keyPresent: boolean;
  /** The model the response reported. Falls back to the requested model only when `modelReported` is false. */
  model: string;
  /** The model slug the request asked for (GROK_MODEL, default grok-4.3). */
  requestedModel: string;
  /** False when the API response carried no `model` field. */
  modelReported: boolean;
  /** Token usage, latency and an estimated cost for this one call. */
  telemetry: GrokTelemetry;
  classify: { category: string; confidence: number };
  extract: string[];
  score: { level: "low" | "medium" | "high" | "critical"; rationale: string };
  summarize: string;
  riskTier: "low" | "medium" | "high";
  blockers: string[];
  trustCheck: GrokIntelTrustCheck;
  mocked: boolean;
  rawPreview?: string;
};

/** Completion budget for one report. A reply cut off at this limit fails visibly. */
export const RELEASE_INTEL_MAX_TOKENS = 2000;
/** Findings (changed file paths for a PR) sent to Grok per call. */
export const RELEASE_INTEL_FINDINGS_LIMIT = 40;
const INTEL_ROLE = "lead" as const;
const INTEL_KEY_ENV = GROK_API_KEY_ENV[INTEL_ROLE];

/** Credential presence only — never returns secret values. */
export function describeGrokIntelKeyStatus(env: NodeJS.ProcessEnv = process.env): {
  keyEnvVar: string;
  keyPresent: boolean;
  usedSharedFallback: false;
  liveReady: boolean;
  mockUnlessLive: string;
} {
  const keyPresent = Boolean(resolveAgentGrokApiKey(INTEL_ROLE, env));
  return {
    keyEnvVar: INTEL_KEY_ENV,
    keyPresent,
    usedSharedFallback: false,
    liveReady: keyPresent,
    mockUnlessLive: keyPresent
      ? `LIVE path ready via exclusive ${INTEL_KEY_ENV}`
      : `${INTEL_KEY_ENV} is not set. Refusing to invent a result.`,
  };
}

function trustNotes(extra: string[]): GrokIntelTrustCheck {
  return {
    schemaValid: true,
    humanGateStillRequired: true,
    noAutoApprove: true,
    keyEnvVar: INTEL_KEY_ENV,
    usedSharedFallback: false,
    notes: extra,
  };
}

export type ReleaseIntelRiskTier = "low" | "medium" | "high";

export const RELEASE_INTEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classify", "summarize", "riskTier", "blockers", "extract", "score"],
  properties: {
    classify: {
      type: "object",
      additionalProperties: false,
      required: ["category", "confidence"],
      properties: {
        category: { type: "string" },
        confidence: { type: "number" },
      },
    },
    summarize: { type: "string" },
    riskTier: { type: "string", enum: ["low", "medium", "high"] },
    blockers: { type: "array", items: { type: "string" } },
    extract: { type: "array", items: { type: "string" } },
    score: {
      type: "object",
      additionalProperties: false,
      required: ["level", "rationale"],
      properties: {
        level: { type: "string", enum: ["low", "medium", "high", "critical"] },
        rationale: { type: "string" },
      },
    },
  },
} as const;

export function trustCheckGrokIntelPayload(payload: {
  classify?: { category?: unknown; confidence?: unknown };
  extract?: unknown;
  score?: { level?: unknown; rationale?: unknown };
  summarize?: unknown;
  riskTier?: unknown;
  blockers?: unknown;
}): { ok: true; confidence: number } | { ok: false; reason: string } {
  if (!payload.classify || payload.summarize == null) {
    return { ok: false, reason: "missing classify/summarize" };
  }
  if (typeof payload.classify.category !== "string" || !payload.classify.category.trim()) {
    return { ok: false, reason: "classify.category invalid" };
  }
  const confidence = Number(payload.classify.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: "classify.confidence out of range [0,1]" };
  }
  if (payload.extract !== undefined && !Array.isArray(payload.extract)) {
    return { ok: false, reason: "extract must be string[]" };
  }
  if (payload.score) {
    const level = String(payload.score.level ?? "");
    if (!["low", "medium", "high", "critical"].includes(level)) {
      return { ok: false, reason: "score.level invalid" };
    }
  }
  if (typeof payload.summarize !== "string" || !payload.summarize.trim()) {
    return { ok: false, reason: "summarize invalid" };
  }
  if (payload.riskTier !== "low" && payload.riskTier !== "medium" && payload.riskTier !== "high") {
    return { ok: false, reason: "riskTier invalid" };
  }
  if (!Array.isArray(payload.blockers) || payload.blockers.some((item) => typeof item !== "string")) {
    return { ok: false, reason: "blockers must be string[]" };
  }
  return { ok: true, confidence };
}


function parseIntelJson(text: string): Partial<GrokReleaseIntelResult> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Partial<GrokReleaseIntelResult>;
  } catch {
    return null;
  }
}

export async function runGrokReleaseIntel(
  input: GrokReleaseIntelInput,
  opts?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  },
): Promise<GrokReleaseIntelResult> {
  const env = (opts?.env ?? process.env) as NodeJS.ProcessEnv;
  const apiKey = resolveAgentGrokApiKey(INTEL_ROLE, env);
  if (!apiKey) throw new MissingCredentialError(INTEL_KEY_ENV);
  const requestedModel = resolveGrokModel(env);

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const promptCacheKey = releaseIntelPromptCacheKey(input.repository, input.pullRequest);
  const system =
    "You are Release Desk Grok intel. Return ONLY JSON matching the schema: classify{category,confidence 0-1}, summarize, riskTier low|medium|high, blockers string[], extract string[], score{level,rationale}. Do not approve merges.";

  try {
    const startedAt = performance.now();
    const res = await fetchImpl(GROK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-grok-conv-id": promptCacheKey,
      },
      body: JSON.stringify(
        buildGrokChatCompletionBody({
          model: requestedModel,
          temperature: 0.1,
          max_tokens: RELEASE_INTEL_MAX_TOKENS,
          promptCacheKey,
          safetySource: `lead:${input.repository}`,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "release_intel",
              strict: true,
              schema: RELEASE_INTEL_JSON_SCHEMA,
            },
          },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: JSON.stringify({
                repository: input.repository,
                goal: input.goal,
                findings: input.findings.slice(0, RELEASE_INTEL_FINDINGS_LIMIT),
              }),
            },
          ],
        }),
      ),
      signal: AbortSignal.timeout(GROK_REQUEST_TIMEOUT_MS),
    });

    assertGrokChatStatus(res.status);
    if (!res.ok) {
      throw new Error(`Grok request failed (${res.status})`);
    }

    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    };
    const telemetry = buildGrokTelemetry({
      requestedModel,
      body,
      latencyMs: performance.now() - startedAt,
    });
    if (body.choices?.[0]?.finish_reason === "length") {
      throw new Error(
        `Grok response was cut off at max_tokens=${RELEASE_INTEL_MAX_TOKENS}. Raise RELEASE_INTEL_MAX_TOKENS in grok-release-intel.ts or shorten the input.`,
      );
    }
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseIntelJson(text);
    const trusted = parsed
      ? trustCheckGrokIntelPayload(parsed)
      : { ok: false as const, reason: "unparseable JSON" };

    if (!trusted.ok || !parsed) {
      const reason = "reason" in trusted ? trusted.reason : "parse";
      throw new Error(`Grok response failed the trust check (${reason})`);
    }

    const extract = Array.isArray(parsed.extract)
      ? parsed.extract.map((x) => String(x)).filter(Boolean)
      : [];
    const scoreLevel = String(
      (parsed.score as { level?: string } | undefined)?.level ?? "medium",
    ) as "low" | "medium" | "high" | "critical";
    const scoreRationale = String(
      (parsed.score as { rationale?: string } | undefined)?.rationale ?? "Grok score",
    );

    const riskTier = parsed.riskTier as ReleaseIntelRiskTier;
    const blockers = Array.isArray(parsed.blockers)
      ? parsed.blockers.map((item) => String(item)).filter(Boolean)
      : [];
    return {
      mode: "live",
      label: "LIVE",
      keyPresent: true,
      model: telemetry.servedModel ?? requestedModel,
      requestedModel,
      modelReported: telemetry.servedModel !== null,
      telemetry,
      classify: {
        category: String(parsed.classify!.category),
        confidence: trusted.confidence,
      },
      extract,
      score: { level: scoreLevel, rationale: scoreRationale },
      summarize: String(parsed.summarize),
      riskTier,
      blockers,
      trustCheck: trustNotes([
        `LIVE Grok API via exclusive ${INTEL_KEY_ENV}`,
        "Schema trust check passed",
        "Human merge/release gates remain authoritative",
      ]),
      mocked: false,
      rawPreview: text.slice(0, 400),
    };
  } catch (err) {
    if (err instanceof MissingCredentialError || err instanceof GrokGuidelineError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Grok request failed: ${message}`);
  }
}
