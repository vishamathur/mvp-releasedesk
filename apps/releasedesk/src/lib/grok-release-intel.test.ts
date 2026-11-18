import { describe, expect, it } from "vitest";
import {
  describeGrokIntelKeyStatus,
  runGrokReleaseIntel,
  trustCheckGrokIntelPayload,
} from "./grok-release-intel";

describe("runGrokReleaseIntel", () => {
  it("returns MOCK without exclusive Lead Grok key (ignores shared XAI/GROK)", async () => {
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
          XAI_API_KEY: "shared-must-not-use",
          GROK_API_KEY: "shared-must-not-use",
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
    expect(result.trustCheck.keyEnvVar).toBe("RELEASEDESK_GROK_API_KEY_LEAD");
    expect(result.summarize).toMatch(/MOCK:/);
    expect(result.classify.category).toBe("security_or_compliance_hold");
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
                  summarize: "Clean wave; human gates still required.",
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
    expect(result.summarize).toContain("human gates");
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
      XAI_API_KEY: "shared",
      GROK_API_KEY: "shared",
    });
    expect(absent.keyPresent).toBe(false);
    expect(absent.liveReady).toBe(false);
    expect(absent.mockUnlessLive).toMatch(/MOCK/);

    const present = describeGrokIntelKeyStatus({
      RELEASEDESK_GROK_API_KEY_LEAD: "lead-key",
      XAI_API_KEY: "shared-ignored",
    });
    expect(present.keyPresent).toBe(true);
    expect(present.liveReady).toBe(true);
    expect(present.mockUnlessLive).toMatch(/LIVE/);
  });
});
