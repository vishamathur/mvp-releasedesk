import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import { releaseIntelForPullRequest } from "./release-intel-pr";

const KEY = "lead-exclusive-test-key";

function githubResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

describe("releaseIntelForPullRequest", () => {
  it("throws when the Lead key is absent and does not call Grok", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/pulls/36")) return githubResponse({ title: "Add riskTier" });
      if (url.includes("/files")) return githubResponse([{ filename: "apps/releasedesk/src/lib/grok-release-intel.ts" }]);
      throw new Error(`unexpected ${url}`);
    };
    await expect(
      releaseIntelForPullRequest({
        fetchImpl,
        env: {
          GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
          PR_NUMBER: "36",
          GITHUB_TOKEN: "ghs_test",
          XAI_API_KEY: "shared-must-not-use",
        },
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
    expect(urls.some((url) => url.includes("api.x.ai"))).toBe(false);
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

  it("throws when the Lead key is absent even if GitHub is unreachable", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    await expect(
      releaseIntelForPullRequest({
        fetchImpl,
        env: {
          GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
          PR_NUMBER: "36",
          GITHUB_TOKEN: "ghs_test",
        },
      }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });
});

describe("releaseIntelForPullRequest head commit and telemetry", () => {
  const HEAD = "5bddf362221b88d9d52b829f5fb84b2cdc17577e";
  const grokReply = {
    model: "grok-4.3",
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            classify: { category: "security_review", confidence: 0.8 },
            extract: [],
            score: { level: "medium", rationale: "r" },
            summarize: "s",
            riskTier: "medium",
            blockers: [],
          }),
        },
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
  };

  function fetchWith(files: string[], headSha: string | undefined): { fetchImpl: typeof fetch; sent: () => unknown } {
    let findings: unknown;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (url.endsWith("/pulls/41")) return githubResponse({ title: "T", head: headSha ? { sha: headSha } : {} });
        return githubResponse(files.map((filename) => ({ filename })));
      }
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      findings = (JSON.parse(body.messages[1]!.content) as { findings: unknown }).findings;
      return githubResponse(grokReply);
    };
    return { fetchImpl, sent: () => findings };
  }

  const baseEnv = {
    GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
    PR_NUMBER: "41",
    GITHUB_TOKEN: "ghs_test",
    RELEASEDESK_GROK_API_KEY_LEAD: KEY,
  };

  it("takes headSha from the GitHub pull request", async () => {
    const { fetchImpl } = fetchWith(["a.ts"], HEAD);
    const report = await releaseIntelForPullRequest({ fetchImpl, env: baseEnv, now: () => new Date("2026-11-26T05:00:00Z") });
    expect(report.schema).toBe("release-intel.v1");
    expect(report.headSha).toBe(HEAD);
    expect(report.headShaSource).toBe("github");
    expect(report.generatedAt).toBe("2026-11-26T05:00:00.000Z");
    expect(report.intel.model).toBe("grok-4.3");
    expect(report.intel.telemetry.promptTokens).toBe(500);
  });

  it("prefers PR_HEAD_SHA from the workflow event over the API", async () => {
    const eventSha = "4160579fee57448d37564fd92ca1321fafbac962";
    const { fetchImpl } = fetchWith(["a.ts"], HEAD);
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: { ...baseEnv, PR_HEAD_SHA: eventSha.toUpperCase() },
    });
    expect(report.headSha).toBe(eventSha);
    expect(report.headShaSource).toBe("env");
  });

  it("says the sha is unavailable rather than guessing one", async () => {
    const { fetchImpl } = fetchWith(["a.ts"], undefined);
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: { ...baseEnv, PR_HEAD_SHA: "not-a-sha" },
    });
    expect(report.headSha).toBeNull();
    expect(report.headShaSource).toBe("unavailable");
  });

  it("reports how many files were returned and how many were sent to Grok", async () => {
    const files = Array.from({ length: 48 }, (_, i) => `apps/kyc/f${i}.ts`);
    const { fetchImpl, sent } = fetchWith(files, HEAD);
    const report = await releaseIntelForPullRequest({ fetchImpl, env: baseEnv });
    expect(report.filesTotal).toBe(48);
    expect(report.filesSent).toBe(40);
    expect((sent() as unknown[]).length).toBe(40);
  });
});

