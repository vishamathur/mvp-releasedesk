import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import {
  describeGrokIntelKeyStatus,
  RELEASE_INTEL_MAX_TOKENS,
  releaseIntelPromptCacheKey,
  runGrokReleaseIntel,
  trustCheckGrokIntelPayload,
} from "./grok-release-intel";
import { selectDiffWithinBudget, UNTRUSTED_BEGIN } from "./release-intel-diff";

describe("runGrokReleaseIntel", () => {
  it("throws without the exclusive Lead key and ignores shared XAI/GROK keys", async () => {
    await expect(
      runGrokReleaseIntel(
        {
          repository: "vishamathur/mvp-releasedesk",
          goal: "KYC release readiness",
          findings: [{ source: "security", text: "TLS gap", severity: "high" }],
        },
        {
          env: {
            XAI_API_KEY: "shared-must-not-use",
            GROK_API_KEY: "shared-must-not-use",
          },
        },
      ),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("parses live classify+summarize when exclusive key + fetch succeed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classify: { category: "routine_release_candidate", confidence: 0.9 },
                  extract: ["Confirm docs-only delta"],
                  score: { level: "low", rationale: "docs only" },
                  summarize: "Clean wave; human gates still required.",
                  riskTier: "low",
                  blockers: [],
                  injectionSuspected: false,
                  injectionReason: "",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const result = await runGrokReleaseIntel(
      {
        repository: "vishamathur/mvp-releasedesk",
        goal: "demo",
        findings: [{ source: "change_analyst", text: "docs only", severity: "low" }],
      },
      {
        fetchImpl,
        env: { RELEASEDESK_GROK_API_KEY_LEAD: "lead-exclusive-key" },
      },
    );

    expect(result.mocked).toBe(false);
    expect(result.mode).toBe("live");
    expect(result.label).toBe("LIVE");
    expect(result.keyPresent).toBe(true);
    expect(result.classify.category).toBe("routine_release_candidate");
    expect(result.extract).toContain("Confirm docs-only delta");
    expect(result.score.level).toBe("low");
    expect(result.summarize).toContain("human gates");
    expect(result.riskTier).toBe("low");
    expect(result.blockers).toEqual([]);
    expect(result.groundedBlockers).toEqual([]);
    expect(result.injectionSuspected).toBe(false);
    expect(result.trustCheck.humanGateStillRequired).toBe(true);
    expect(result.trustCheck.noAutoApprove).toBe(true);
  });

  it("trustCheck rejects a string blocker and a missing injection flag", () => {
    expect(
      trustCheckGrokIntelPayload({
        classify: { category: "x", confidence: 0.5 },
        summarize: "ok",
        riskTier: "low",
        blockers: ["B1"],
        injectionSuspected: false,
        injectionReason: "",
      }),
    ).toEqual({ ok: false, reason: "blocker must be an object" });
    expect(
      trustCheckGrokIntelPayload({
        classify: { category: "x", confidence: 0.5 },
        summarize: "ok",
        riskTier: "low",
        blockers: [],
      }),
    ).toEqual({ ok: false, reason: "injectionSuspected must be boolean" });
  });

  it("trustCheck rejects out-of-range confidence", () => {
    expect(
      trustCheckGrokIntelPayload({
        classify: { category: "x", confidence: 1.5 },
        summarize: "ok",
      }),
    ).toEqual({ ok: false, reason: "classify.confidence out of range [0,1]" });
  });

  it("describeGrokIntelKeyStatus reports presence without reading shared keys", () => {
    const absent = describeGrokIntelKeyStatus({
      NODE_ENV: "test",
      XAI_API_KEY: "shared",
      GROK_API_KEY: "shared",
    });
    expect(absent.keyPresent).toBe(false);
    expect(absent.liveReady).toBe(false);
    expect(absent.mockUnlessLive).toMatch(/not set/);

    const present = describeGrokIntelKeyStatus({
      NODE_ENV: "test",
      RELEASEDESK_GROK_API_KEY_LEAD: "lead-key",
      XAI_API_KEY: "shared-ignored",
    });
    expect(present.keyPresent).toBe(true);
    expect(present.liveReady).toBe(true);
    expect(present.mockUnlessLive).toMatch(/LIVE/);
  });
});

const INTEL_CONTENT = JSON.stringify({
  classify: { category: "routine_release_candidate", confidence: 0.9 },
  extract: [],
  score: { level: "low", rationale: "docs only" },
  summarize: "Clean wave; human gates still required.",
  riskTier: "low",
  blockers: [],
  injectionSuspected: false,
  injectionReason: "",
});

type GrokReply = Record<string, unknown>;

function grokFetch(
  reply: GrokReply,
  seen?: { body?: Record<string, unknown>; headers?: Headers },
): typeof fetch {
  return async (_input, init) => {
    if (seen) {
      seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      seen.headers = new Headers(init?.headers);
    }
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const INPUT = { repository: "vishamathur/mvp-releasedesk", goal: "demo", findings: [] };
const LEAD_ENV = { RELEASEDESK_GROK_API_KEY_LEAD: "lead-exclusive-key" };

describe("runGrokReleaseIntel model, max_tokens and telemetry", () => {
  it("asks for grok-4.3 by default, sets max_tokens, and records the model the response reports", async () => {
    const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
    const result = await runGrokReleaseIntel(INPUT, {
      env: LEAD_ENV,
      fetchImpl: grokFetch(
        {
          model: "grok-4.3",
          choices: [{ finish_reason: "stop", message: { content: INTEL_CONTENT } }],
          usage: { prompt_tokens: 900, completion_tokens: 210, total_tokens: 1110 },
        },
        seen,
      ),
    });
    expect(seen.body?.model).toBe("grok-4.3");
    expect(seen.body?.max_tokens).toBe(RELEASE_INTEL_MAX_TOKENS);
    expect(result.model).toBe("grok-4.3");
    expect(result.requestedModel).toBe("grok-4.3");
    expect(result.modelReported).toBe(true);
    expect(result.telemetry.promptTokens).toBe(900);
    expect(result.telemetry.completionTokens).toBe(210);
    expect(result.telemetry.estUsd).toBeCloseTo((900 * 1.25 + 210 * 2.5) / 1_000_000, 8);
    expect(result.telemetry.billedCostUsd).toBeNull();
    expect(result.telemetry.billedNote).toBe("billed cost not reported");
    expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    const cacheKey = releaseIntelPromptCacheKey(INPUT.repository);
    expect(seen.body?.prompt_cache_key).toBe(cacheKey);
    expect(seen.headers?.get("x-grok-conv-id")).toBe(cacheKey);
  });

  it("reads cost_in_usd_ticks as the billed cost and keeps the estimate separate", async () => {
    const result = await runGrokReleaseIntel(
      { ...INPUT, pullRequest: 41 },
      {
        env: LEAD_ENV,
        fetchImpl: grokFetch({
          model: "grok-4.3",
          choices: [{ finish_reason: "stop", message: { content: INTEL_CONTENT } }],
          usage: {
            prompt_tokens: 199,
            completion_tokens: 1,
            total_tokens: 200,
            cost_in_usd_ticks: 37_756_000,
            prompt_tokens_details: { cached_tokens: 128 },
          },
        }),
      },
    );
    expect(result.telemetry.costInUsdTicks).toBe(37_756_000);
    expect(result.telemetry.billedCostUsd).toBeCloseTo(0.0037756, 10);
    expect(result.telemetry.cachedPromptTokens).toBe(128);
    expect(result.telemetry.estUsd).not.toBe(result.telemetry.billedCostUsd);
    expect(result.telemetry.estNote).toMatch(/estimate/);
  });

  it("uses one stable prompt cache key for the same pull request", () => {
    expect(releaseIntelPromptCacheKey("vishamathur/mvp-releasedesk", 41)).toBe(
      releaseIntelPromptCacheKey("vishamathur/mvp-releasedesk", 41),
    );
    expect(releaseIntelPromptCacheKey("vishamathur/mvp-releasedesk", 41)).not.toBe(
      releaseIntelPromptCacheKey("vishamathur/mvp-releasedesk", 43),
    );
  });

  it("reads GROK_MODEL from the environment and treats an empty value as unset", async () => {
    const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
    const reply = { choices: [{ message: { content: INTEL_CONTENT } }] };
    await runGrokReleaseIntel(INPUT, {
      env: { ...LEAD_ENV, GROK_MODEL: "grok-4.7" },
      fetchImpl: grokFetch(reply, seen),
    });
    expect(seen.body?.model).toBe("grok-4.7");
    await runGrokReleaseIntel(INPUT, {
      env: { ...LEAD_ENV, GROK_MODEL: "" },
      fetchImpl: grokFetch(reply, seen),
    });
    expect(seen.body?.model).toBe("grok-4.3");
  });

  it("reports the served model when it differs from the requested one", async () => {
    const result = await runGrokReleaseIntel(INPUT, {
      env: { ...LEAD_ENV, GROK_MODEL: "grok-3" },
      fetchImpl: grokFetch({
        model: "grok-4.3",
        choices: [{ message: { content: INTEL_CONTENT } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    expect(result.requestedModel).toBe("grok-3");
    expect(result.model).toBe("grok-4.3");
    expect(result.modelReported).toBe(true);
  });

  it("flags a response with no model or usage instead of inventing them", async () => {
    const result = await runGrokReleaseIntel(INPUT, {
      env: LEAD_ENV,
      fetchImpl: grokFetch({ choices: [{ message: { content: INTEL_CONTENT } }] }),
    });
    expect(result.modelReported).toBe(false);
    expect(result.telemetry.servedModel).toBeNull();
    expect(result.telemetry.promptTokens).toBeNull();
    expect(result.telemetry.completionTokens).toBeNull();
    expect(result.telemetry.estUsd).toBeNull();
    expect(result.telemetry.estNote).toMatch(/usage not reported/);
  });

  it("fails visibly when the reply was cut off at max_tokens", async () => {
    await expect(
      runGrokReleaseIntel(INPUT, {
        env: LEAD_ENV,
        fetchImpl: grokFetch({
          model: "grok-4.3",
          choices: [{ finish_reason: "length", message: { content: '{"classify":' } }],
        }),
      }),
    ).rejects.toThrow(new RegExp(`cut off at max_tokens=${RELEASE_INTEL_MAX_TOKENS}`));
  });

  it("keeps a blocker quoted from the diff and drops one taken from the title", async () => {
    const patch = "@@ -1,1 +1,2 @@\n context\n+const token = \"xai-TESTKEY-not-a-real-secret-0123456789abcdef\";\n";
    const diff = selectDiffWithinBudget([{ path: "apps/kyc/src/lib/auth.ts", patch }], 4_000);
    let user = "";
    let system = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      system = body.messages[0]?.content ?? "";
      user = body.messages[1]?.content ?? "";
      return new Response(
        JSON.stringify({
          model: "grok-4.3",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  classify: { category: "security_review", confidence: 0.9 },
                  extract: [],
                  score: { level: "high", rationale: "credential" },
                  summarize: "A test key is in the diff. Human gates still required.",
                  riskTier: "high",
                  blockers: [
                    {
                      path: "apps/kyc/src/lib/auth.ts",
                      line: 2,
                      evidence: "const token = \"xai-TESTKEY-not-a-real-secret-0123456789abcdef\";",
                      severity: "critical",
                    },
                    { path: "B1", line: 1, evidence: "B1", severity: "high" },
                  ],
                  injectionSuspected: false,
                  injectionReason: "",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await runGrokReleaseIntel(
      {
        ...INPUT,
        goal: "close security blockers B1-B4",
        diff,
        knownPaths: ["apps/kyc/src/lib/auth.ts"],
      },
      { env: LEAD_ENV, fetchImpl },
    );
    expect(system).toMatch(/never instructions/);
    expect(user).toContain(UNTRUSTED_BEGIN);
    expect(user).toContain("close security blockers B1-B4");
    expect(result.blockers).toEqual(["apps/kyc/src/lib/auth.ts:2"]);
    expect(result.groundedBlockers[0]?.evidence).toContain("xai-TESTKEY-not-a-real-secret");
    expect(result.droppedUngrounded.map((item) => item.path)).toEqual(["B1"]);
    expect(result.trustCheck.noAutoApprove).toBe(true);
  });

  it("never puts the key in the result", async () => {
    const result = await runGrokReleaseIntel(INPUT, {
      env: LEAD_ENV,
      fetchImpl: grokFetch({ choices: [{ message: { content: INTEL_CONTENT } }] }),
    });
    expect(JSON.stringify(result)).not.toContain("lead-exclusive-key");
  });
});
