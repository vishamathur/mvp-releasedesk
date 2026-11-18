/**
 * Grok API release intel — shipped Desk module (classify + extract + score + summarize).
 *
 * Live key: RELEASEDESK_GROK_API_KEY_LEAD only.
 * Shared XAI_API_KEY / GROK_API_KEY are never consulted.
 * Absent key → MOCK-labeled fallback.
 *
 * Specialist ship twin: packages/releasedesk-specialists/src/grok-api-intel.ts
 * (Builder exclusive key) — Cursor Coding agent hardens both.
 */

import { GROK_API_KEY_ENV, resolveAgentGrokApiKey } from "@releasedesk/core";

export type GrokIntelMode = "live" | "mock";

export type GrokReleaseIntelInput = {
  repository: string;
  goal: string;
  findings: Array<{ source: string; text: string; severity?: string }>;
};

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
  model: string;
  classify: { category: string; confidence: number };
  extract: string[];
  score: { level: "low" | "medium" | "high" | "critical"; rationale: string };
  summarize: string;
  trustCheck: GrokIntelTrustCheck;
  mocked: boolean;
  rawPreview?: string;
};

/** Default model: grok-2-latest is retired/404 for many teams — prefer grok-3. */
const MODEL = process.env.GROK_MODEL?.trim() || "grok-3";
const INTEL_ROLE = "lead" as const;
const INTEL_KEY_ENV = GROK_API_KEY_ENV[INTEL_ROLE];

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

export function trustCheckGrokIntelPayload(payload: {
  classify?: { category?: unknown; confidence?: unknown };
  extract?: unknown;
  score?: { level?: unknown; rationale?: unknown };
  summarize?: unknown;
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
  return { ok: true, confidence };
}

function mockIntel(
  input: GrokReleaseIntelInput,
  reason: "missing_key" | "upstream" = "missing_key",
): GrokReleaseIntelResult {
  const severe = input.findings.filter((f) =>
    ["high", "critical"].includes((f.severity ?? "").toLowerCase()),
  );
  const reasonNote =
    reason === "missing_key"
      ? `MOCK: no ${INTEL_KEY_ENV} — deterministic fallback`
      : `MOCK: ${INTEL_KEY_ENV} present but live Grok call failed — deterministic fallback`;
  return {
    mode: "mock",
    model: MODEL,
    classify: {
      category: severe.length ? "security_or_compliance_hold" : "routine_release_candidate",
      confidence: 0.62,
    },
    extract: input.findings.slice(0, 3).map((f) => `Remediate: ${f.text}`),
    score: {
      level: severe.length ? "high" : input.findings.length ? "medium" : "low",
      rationale: severe.length
        ? "Blocking severity present in findings"
        : "No high/critical findings in sample",
    },
    summarize: `MOCK: ${input.repository} — ${input.goal}. ${input.findings.length} finding(s); ${severe.length} high/critical. Human gates still required.`,
    trustCheck: trustNotes([
      reasonNote,
      "Shared XAI_API_KEY / GROK_API_KEY never used",
      "Grok never auto-approves merge/release",
    ]),
    mocked: true,
  };
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
  if (!apiKey) return mockIntel(input);

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const system =
    "You are Release Desk Grok intel. Return ONLY JSON: classify{category,confidence 0-1}, extract(string[]), score{level:low|medium|high|critical,rationale}, summarize(string). Do not approve merges.";

  try {
    const res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              repository: input.repository,
              goal: input.goal,
              findings: input.findings.slice(0, 40),
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      const fallback = mockIntel(input, "upstream");
      fallback.trustCheck.notes.unshift(`MOCK fallback: Grok HTTP ${res.status}`);
      return fallback;
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseIntelJson(text);
    const trusted = parsed
      ? trustCheckGrokIntelPayload(parsed)
      : { ok: false as const, reason: "unparseable JSON" };

    if (!trusted.ok || !parsed) {
      const fallback = mockIntel(input, "upstream");
      fallback.trustCheck.notes.unshift(
        `MOCK fallback: trust check failed (${"reason" in trusted ? trusted.reason : "parse"})`,
      );
      fallback.rawPreview = text.slice(0, 500);
      return fallback;
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

    return {
      mode: "live",
      model: MODEL,
      classify: {
        category: String(parsed.classify!.category),
        confidence: trusted.confidence,
      },
      extract,
      score: { level: scoreLevel, rationale: scoreRationale },
      summarize: String(parsed.summarize),
      trustCheck: trustNotes([
        `Live Grok API via exclusive ${INTEL_KEY_ENV}`,
        "Schema trust check passed",
        "Human merge/release gates remain authoritative",
      ]),
      mocked: false,
      rawPreview: text.slice(0, 400),
    };
  } catch (err) {
    const fallback = mockIntel(input, "upstream");
    fallback.trustCheck.notes.unshift(
      `MOCK fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}
