import { describe, expect, it } from "vitest";
import { runGrokReleaseIntel } from "./grok-release-intel";

describe("runGrokReleaseIntel", () => {
  it("returns MOCK schema-valid intel without API key", async () => {
    const prevX = process.env.XAI_API_KEY;
    const prevG = process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;

    const result = await runGrokReleaseIntel({
      repository: "vishamathur/mvp-releasedesk",
      goal: "KYC release readiness",
      findings: [
        { source: "security", text: "TLS gap", severity: "high" },
        { source: "standards", text: "retention deviation", severity: "medium" },
      ],
    });

    expect(result.mocked).toBe(true);
    expect(result.mode).toBe("mock");
    expect(result.trustCheck.humanGateStillRequired).toBe(true);
    expect(result.trustCheck.schemaValid).toBe(true);
    expect(result.score.releaseRisk).toBeGreaterThan(0);
    expect(result.summarize).toMatch(/MOCK:/);

    if (prevX !== undefined) process.env.XAI_API_KEY = prevX;
    if (prevG !== undefined) process.env.GROK_API_KEY = prevG;
  });

  it("parses live Grok JSON when fetch returns content", async () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classify: { category: "routine_release_candidate", confidence: 0.9 },
                  extract: { entities: ["apps/kyc"], openQuestions: ["Sign-off done?"] },
                  score: { releaseRisk: 18, rationale: "Low residual risk" },
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
      { fetchImpl },
    );

    expect(result.mocked).toBe(false);
    expect(result.mode).toBe("live");
    expect(result.classify.category).toBe("routine_release_candidate");
    expect(result.score.releaseRisk).toBe(18);
    expect(result.trustCheck.humanGateStillRequired).toBe(true);

    if (prev !== undefined) process.env.XAI_API_KEY = prev;
    else delete process.env.XAI_API_KEY;
  });
});
