import { describe, expect, it } from "vitest";
import { releaseIntelForPullRequest } from "./release-intel-pr";

const KEY = "lead-exclusive-test-key";

function githubResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

describe("releaseIntelForPullRequest", () => {
  it("prints a MOCK report when the Lead key is absent and does not call Grok", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/pulls/36")) return githubResponse({ title: "Add riskTier" });
      if (url.includes("/files")) return githubResponse([{ filename: "apps/releasedesk/src/lib/grok-release-intel.ts" }]);
      throw new Error(`unexpected ${url}`);
    };
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: {
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        PR_NUMBER: "36",
        GITHUB_TOKEN: "ghs_test",
        XAI_API_KEY: "shared-must-not-use",
      },
    });
    expect(report.heading).toBe("release-intel v1");
    expect(report.label).toBe("MOCK");
    expect(report.mode).toBe("mock");
    expect(report.title).toBe("Add riskTier");
    expect(report.changedPaths).toEqual(["apps/releasedesk/src/lib/grok-release-intel.ts"]);
    expect(report.intel.riskTier).toBe("medium");
    expect(report.intel.blockers).toEqual([]);
    expect(urls.some((url) => url.includes("api.x.ai"))).toBe(false);
    expect(JSON.stringify(report)).not.toContain("shared-must-not-use");
    expect(JSON.stringify(report)).not.toContain("ghs_test");
  });

  it("calls Grok with the exclusive key and returns LIVE riskTier and blockers", async () => {
    let grokAuth = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (url.endsWith("/pulls/7")) return githubResponse({ title: "Ship intel" });
        return githubResponse([{ filename: "apps/releasedesk/src/lib/grok-release-intel.ts" }]);
      }
      grokAuth = new Headers(init?.headers).get("authorization") ?? "";
      const body = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { strict?: boolean } } };
      expect(body.response_format?.json_schema?.strict).toBe(true);
      return githubResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                classify: { category: "routine_release_candidate", confidence: 0.8 },
                extract: ["risk tier"],
                score: { level: "medium", rationale: "new field" },
                summarize: "Adds riskTier. Human gates still required.",
                riskTier: "medium",
                blockers: ["confirm test gate"],
              }),
            },
          },
        ],
      });
    };
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: {
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        PR_NUMBER: "7",
        GITHUB_TOKEN: "ghs_test",
        RELEASEDESK_GROK_API_KEY_LEAD: KEY,
      },
    });
    expect(report.label).toBe("LIVE");
    expect(report.intel.riskTier).toBe("medium");
    expect(report.intel.blockers).toEqual(["confirm test gate"]);
    expect(grokAuth).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(report)).not.toContain(KEY);
  });

  it("stays MOCK and does not throw when GitHub is unreachable", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: {
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        PR_NUMBER: "36",
        GITHUB_TOKEN: "ghs_test",
      },
    });
    expect(report.label).toBe("MOCK");
    expect(report.changedPaths).toEqual([]);
  });
});
