import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import {
  describeGrokIntelKeyStatus,
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
