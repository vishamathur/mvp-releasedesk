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
  GrokGuidelineError,
  MissingCredentialError,
  resolveAgentGrokApiKey,
  resolveGrokModel,
  type GrokTelemetry,
} from "@releasedesk/core";
import {
  RELEASE_INTEL_SYSTEM_PROMPT,
  buildReleaseIntelUserContent,
  groundedBlockerLabel,
  applyDeterministicRubric,
  partitionGroundedBlockers,
  type BudgetedDiff,
  type DroppedBlocker,
  type GroundedBlocker,
} from "./release-intel-diff";

export type GrokIntelMode = "live";

export type GrokReleaseIntelInput = {
  repository: string;
  goal: string;
  findings: Array<{ source: string; text: string; severity?: string }>;
  /** Pull request number, when this call is about one. Used only as a stable cache key. */
  pullRequest?: number | null;
  /** Unified diff sent to the model. Blockers are grounded against these files only. */
  diff?: BudgetedDiff | null;
  /** Every changed path, including files the token budget did not send. */
  knownPaths?: string[];
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
  /** Token usage, latency, billed cost, and a separately labelled estimate. */
  telemetry: GrokTelemetry;
  classify: { category: string; confidence: number };
  extract: string[];
  score: { level: "low" | "medium" | "high" | "critical"; rationale: string };
  summarize: string;
  riskTier: "low" | "medium" | "high";
  /**
   * Grounded blockers as `path:line` strings so a v1 reader can still join them.
   * The structured records are `groundedBlockers`. Ids are never taken from the title.
   */
  blockers: string[];
  groundedBlockers: GroundedBlocker[];
  droppedUngrounded: DroppedBlocker[];
  injectionSuspected: boolean;
  injectionReason: string;
  trustCheck: GrokIntelTrustCheck;
  mocked: boolean;
  rawPreview?: string;
};

/** Completion budget for one report. A reply cut off at this limit fails visibly. */
export const RELEASE_INTEL_MAX_TOKENS = 4000;
/** Diff review can outlast the shared 30s chat timeout. This call fails visibly at this limit. */
export const RELEASE_INTEL_TIMEOUT_MS = 120_000;

/**
 * Timeout for one release-intel call. `override` wins, then `RELEASE_INTEL_TIMEOUT_MS`,
 * then the 120000 ms default. A bad value throws. It never silently keeps going.
 */
export function resolveReleaseIntelTimeoutMs(
  env: Record<string, string | undefined> = process.env,
  override?: number,
): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1) {
      throw new Error("release-intel timeout must be a positive integer number of milliseconds");
    }
    return override;
  }
  const raw = env.RELEASE_INTEL_TIMEOUT_MS?.trim();
  if (!raw) return RELEASE_INTEL_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("RELEASE_INTEL_TIMEOUT_MS must be a positive integer number of milliseconds");
  }
  return value;
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  return err.name === "AbortError" && /timeout/i.test(err.message);
}
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
  required: [
    "classify",
    "summarize",
    "riskTier",
    "blockers",
    "extract",
    "score",
    "injectionSuspected",
    "injectionReason",
  ],
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
    blockers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "evidence", "severity"],
        properties: {
          path: { type: "string" },
          line: { type: "integer" },
          evidence: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
      },
    },
    injectionSuspected: { type: "boolean" },
    injectionReason: { type: "string" },
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
  injectionSuspected?: unknown;
  injectionReason?: unknown;
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
  if (!Array.isArray(payload.blockers)) {
    return { ok: false, reason: "blockers must be an array" };
  }
  for (const item of payload.blockers) {
    if (!item || typeof item !== "object") return { ok: false, reason: "blocker must be an object" };
    const blocker = item as Record<string, unknown>;
    if (typeof blocker.path !== "string" || !blocker.path.trim()) {
      return { ok: false, reason: "blocker.path invalid" };
    }
    if (typeof blocker.line !== "number" || !Number.isInteger(blocker.line) || blocker.line < 1) {
      return { ok: false, reason: "blocker.line invalid" };
    }
    if (typeof blocker.evidence !== "string" || !blocker.evidence.trim()) {
      return { ok: false, reason: "blocker.evidence invalid" };
    }
    if (
      blocker.severity !== "low" &&
      blocker.severity !== "medium" &&
      blocker.severity !== "high" &&
      blocker.severity !== "critical"
    ) {
      return { ok: false, reason: "blocker.severity invalid" };
    }
  }
  if (typeof payload.injectionSuspected !== "boolean") {
    return { ok: false, reason: "injectionSuspected must be boolean" };
  }
  if (typeof payload.injectionReason !== "string") {
    return { ok: false, reason: "injectionReason must be a string" };
  }
  if (payload.injectionSuspected && !payload.injectionReason.trim()) {
    return { ok: false, reason: "injectionReason required when injection is suspected" };
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
    /** Fault-injection and tests only. Production leaves this unset and calls api.x.ai. */
    endpoint?: string;
    /** Overrides RELEASE_INTEL_TIMEOUT_MS for this call. */
    timeoutMs?: number;
  },
): Promise<GrokReleaseIntelResult> {
  const env = (opts?.env ?? process.env) as NodeJS.ProcessEnv;
  const apiKey = resolveAgentGrokApiKey(INTEL_ROLE, env);
  if (!apiKey) throw new MissingCredentialError(INTEL_KEY_ENV);
  const requestedModel = resolveGrokModel(env);
  const timeoutMs = resolveReleaseIntelTimeoutMs(env, opts?.timeoutMs);
  const endpoint = opts?.endpoint?.trim() || GROK_CHAT_COMPLETIONS_URL;

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const promptCacheKey = releaseIntelPromptCacheKey(input.repository, input.pullRequest);
  const system = RELEASE_INTEL_SYSTEM_PROMPT;
  const user = buildReleaseIntelUserContent({
    repository: input.repository,
    title: input.goal,
    diff: input.diff ?? null,
    findings: input.findings,
  });

  try {
    const startedAt = performance.now();
    const res = await fetchImpl(endpoint, {
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
            { role: "user", content: user },
          ],
        }),
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });

    assertGrokChatStatus(res.status);
    if (!res.ok) {
      throw new Error(`Grok request failed (${res.status})`);
    }

    const raw = await res.text();
    if (!raw.trim()) throw new Error("Grok response content was empty");
    let body: {
      model?: string;
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      throw new Error("Grok response was not JSON");
    }
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      throw new Error("Grok response had no choices");
    }
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
    const text = body.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Grok response content was empty");
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
    const partitioned = partitionGroundedBlockers(parsed.blockers, input.diff?.files ?? [], input.knownPaths);
    const injectionSuspected = parsed.injectionSuspected === true;
    const injectionReason = typeof parsed.injectionReason === "string" ? parsed.injectionReason : "";
    const groundedBlockers = applyDeterministicRubric({
      grounded: partitioned.grounded,
      files: input.diff?.files ?? [],
      injectionSuspected,
    });
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
      blockers: groundedBlockers.map(groundedBlockerLabel),
      groundedBlockers,
      droppedUngrounded: partitioned.dropped,
      injectionSuspected,
      injectionReason,
      trustCheck: trustNotes([
        `LIVE Grok API via exclusive ${INTEL_KEY_ENV}`,
        "Schema trust check passed",
        "Blockers that the diff does not support were dropped",
        "Human merge/release gates remain authoritative",
      ]),
      mocked: false,
      rawPreview: text.slice(0, 400),
    };
  } catch (err) {
    if (err instanceof MissingCredentialError || err instanceof GrokGuidelineError) throw err;
    if (isTimeoutError(err)) {
      throw new Error(`Grok request timed out after ${timeoutMs} ms`);
    }
    if (err instanceof Error && err.message.startsWith("Grok ")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Grok request failed: ${message}`);
  }
}
