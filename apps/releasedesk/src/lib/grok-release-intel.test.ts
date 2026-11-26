import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import {
  describeGrokIntelKeyStatus,
  RELEASE_INTEL_MAX_TOKENS,
  runGrokReleaseIntel,
  trustCheckGrokIntelPayload,
} from "./grok-release-intel";

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
    expect(result.trustCheck.humanGateStillRequired).toBe(true);
    expect(result.trustCheck.noAutoApprove).toBe(true);
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
});

type GrokReply = Record<string, unknown>;

function grokFetch(reply: GrokReply, seen?: { body?: Record<string, unknown> }): typeof fetch {
  return async (_input, init) => {
    if (seen) seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
    const seen: { body?: Record<string, unknown> } = {};
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
    expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads GROK_MODEL from the environment and treats an empty value as unset", async () => {
    const seen: { body?: Record<string, unknown> } = {};
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
    ).rejects.toThrow(/cut off at max_tokens=2000/);
  });

  it("never puts the key in the result", async () => {
    const result = await runGrokReleaseIntel(INPUT, {
      env: LEAD_ENV,
      fetchImpl: grokFetch({ choices: [{ message: { content: INTEL_CONTENT } }] }),
    });
    expect(JSON.stringify(result)).not.toContain("lead-exclusive-key");
  });
});
