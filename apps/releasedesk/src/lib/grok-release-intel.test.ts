import { describe, expect, it } from "vitest";
import {
  describeGrokIntelKeyStatus,
  GROK_RELEASE_INTEL_JSON_SCHEMA,
  runGrokReleaseIntel,
  trustCheckGrokIntelPayload,
} from "./grok-release-intel";

describe("runGrokReleaseIntel", () => {
  it("returns MOCK when the app key is absent, even if per-bot keys are set", async () => {
    const result = await runGrokReleaseIntel(
      {
        repository: "vishamathur/mvp-releasedesk",
        goal: "KYC release readiness",
        findings: [
          { source: "security", text: "TLS gap", severity: "high" },
          { source: "standards", text: "retention deviation", severity: "medium" },
        ],
      },
      {
        env: {
          GROK_API_KEY: "alias-ignored",
          RELEASEDESK_GROK_API_KEY_LEAD: "per-bot-ignored",
        },
      },
    );

    expect(result.mocked).toBe(true);
    expect(result.mode).toBe("mock");
    expect(result.label).toBe("MOCK");
    expect(result.keyPresent).toBe(false);
    expect(result.trustCheck.humanGateStillRequired).toBe(true);
    expect(result.trustCheck.schemaValid).toBe(true);
    expect(result.trustCheck.usedSharedFallback).toBe(false);
    expect(result.trustCheck.keyEnvVar).toBe("XAI_API_KEY");
    expect(result.summarize).toMatch(/MOCK:/);
    expect(result.classify.category).toBe("security_or_compliance_hold");
  });

  it("sends json_schema and parses classify+summarize when the app key is set", async () => {
    let sent: { response_format?: { type?: string; json_schema?: { name?: string } } } = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classify: { category: "routine_release_candidate", confidence: 0.9 },
                  extract: ["Confirm docs-only delta"],
                  score: { level: "low", rationale: "docs only" },
                  summarize: "Clean wave; human gates still required.",
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
        repository: "vishamathur/mvp-releasedesk",
        goal: "demo",
        findings: [{ source: "change_analyst", text: "docs only", severity: "low" }],
      },
      {
        fetchImpl,
        env: {
          XAI_API_KEY: "app-key",
          RELEASEDESK_GROK_API_KEY_LEAD: "per-bot-ignored",
        },
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
    expect(result.trustCheck.humanGateStillRequired).toBe(true);
    expect(result.trustCheck.noAutoApprove).toBe(true);
    expect(sent.response_format?.type).toBe("json_schema");
    expect(sent.response_format?.json_schema?.name).toBe(GROK_RELEASE_INTEL_JSON_SCHEMA.name);
  });

  it("trustCheck rejects out-of-range confidence", () => {
    expect(
      trustCheckGrokIntelPayload({
        classify: { category: "x", confidence: 1.5 },
        summarize: "ok",
      }),
    ).toEqual({ ok: false, reason: "classify.confidence out of range [0,1]" });
  });

  it("describeGrokIntelKeyStatus reports the app key and ignores per-bot keys", () => {
    const absent = describeGrokIntelKeyStatus({
      NODE_ENV: "test",
      GROK_API_KEY: "alias",
      RELEASEDESK_GROK_API_KEY_LEAD: "per-bot",
    });
    expect(absent.keyPresent).toBe(false);
    expect(absent.keyEnvVar).toBe("XAI_API_KEY");
    expect(absent.liveReady).toBe(false);
    expect(absent.mockUnlessLive).toMatch(/MOCK/);

    const present = describeGrokIntelKeyStatus({
      NODE_ENV: "test",
      XAI_API_KEY: "app-key",
      RELEASEDESK_GROK_API_KEY_LEAD: "per-bot-ignored",
    });
    expect(present.keyPresent).toBe(true);
    expect(present.liveReady).toBe(true);
    expect(present.mockUnlessLive).toMatch(/LIVE/);
  });
});
