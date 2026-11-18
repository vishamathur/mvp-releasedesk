/**
 * Grok API release intel — shipped product path for SpaceXAI challenge.
 * Classifies, extracts, scores, and summarizes release findings.
 * Without XAI_API_KEY / GROK_API_KEY → MOCK-labeled deterministic fallback.
 */

export type GrokIntelMode = "live" | "mock";

export type GrokReleaseIntelInput = {
  repository: string;
  goal: string;
  findings: Array<{ source: string; text: string; severity?: string }>;
};

export type GrokReleaseIntelResult = {
  mode: GrokIntelMode;
  model: string;
  classify: { category: string; confidence: number };
  extract: { entities: string[]; openQuestions: string[] };
  score: { releaseRisk: number; rationale: string };
  summarize: string;
  trustCheck: {
    schemaValid: boolean;
    humanGateStillRequired: true;
    notes: string[];
  };
  mocked: boolean;
  rawPreview?: string;
};

const MODEL = process.env.GROK_MODEL?.trim() || "grok-2-latest";

function resolveApiKey(): string | undefined {
  const key = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

function mockIntel(input: GrokReleaseIntelInput): GrokReleaseIntelResult {
  const severe = input.findings.filter((f) =>
    ["high", "critical"].includes((f.severity ?? "").toLowerCase()),
  );
  const releaseRisk = Math.min(100, 25 + severe.length * 20 + input.findings.length * 5);
  return {
    mode: "mock",
    model: MODEL,
    classify: {
      category: severe.length ? "security_or_compliance_hold" : "routine_release_candidate",
      confidence: 0.62,
    },
    extract: {
      entities: [...new Set(input.findings.map((f) => f.source))].slice(0, 8),
      openQuestions: severe.length
        ? ["Which findings are release-blocking vs waivable?"]
        : ["Confirm feature sign-off checklist complete?"],
    },
    score: {
      releaseRisk,
      rationale: `MOCK: heuristic risk from ${input.findings.length} finding(s), ${severe.length} high/critical`,
    },
    summarize: `MOCK: Release intel for ${input.repository} — ${input.goal}. ${input.findings.length} finding(s); risk ${releaseRisk}/100. Human merge/release gates still required.`,
    trustCheck: {
      schemaValid: true,
      humanGateStillRequired: true,
      notes: [
        "MOCK: no XAI_API_KEY — deterministic fallback",
        "Grok scores never auto-approve merge/release",
        "Cross-check against Security + iteration gate (red_team|security)",
      ],
    },
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
  opts?: { fetchImpl?: typeof fetch },
): Promise<GrokReleaseIntelResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) return mockIntel(input);

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const system = [
    "You are Release Desk Grok intel.",
    "Return ONLY JSON with keys: classify{category,confidence}, extract{entities,openQuestions},",
    "score{releaseRisk 0-100,rationale}, summarize (string).",
    "Do not approve merges. Humans decide.",
  ].join(" ");

  const user = JSON.stringify({
    repository: input.repository,
    goal: input.goal,
    findings: input.findings.slice(0, 40),
  });

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
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const fallback = mockIntel(input);
      fallback.trustCheck.notes.unshift(`MOCK fallback: Grok HTTP ${res.status}`);
      return fallback;
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseIntelJson(text);
    if (!parsed?.classify || !parsed?.extract || !parsed?.score || !parsed?.summarize) {
      const fallback = mockIntel(input);
      fallback.trustCheck.notes.unshift("MOCK fallback: could not parse Grok JSON");
      fallback.rawPreview = text.slice(0, 500);
      return fallback;
    }

    const releaseRisk = Number(parsed.score.releaseRisk);
    return {
      mode: "live",
      model: MODEL,
      classify: {
        category: String(parsed.classify.category ?? "unknown"),
        confidence: Number(parsed.classify.confidence ?? 0),
      },
      extract: {
        entities: Array.isArray(parsed.extract.entities)
          ? parsed.extract.entities.map(String)
          : [],
        openQuestions: Array.isArray(parsed.extract.openQuestions)
          ? parsed.extract.openQuestions.map(String)
          : [],
      },
      score: {
        releaseRisk: Number.isFinite(releaseRisk) ? releaseRisk : 50,
        rationale: String(parsed.score.rationale ?? ""),
      },
      summarize: String(parsed.summarize),
      trustCheck: {
        schemaValid: true,
        humanGateStillRequired: true,
        notes: [
          "Live Grok API response schema-validated",
          "Compare score to Security blockers + iteration gate",
          "Human merge/release gates remain authoritative",
        ],
      },
      mocked: false,
      rawPreview: text.slice(0, 400),
    };
  } catch (err) {
    const fallback = mockIntel(input);
    const message = err instanceof Error ? err.message : String(err);
    fallback.trustCheck.notes.unshift(`MOCK fallback: ${message}`);
    return fallback;
  }
}
