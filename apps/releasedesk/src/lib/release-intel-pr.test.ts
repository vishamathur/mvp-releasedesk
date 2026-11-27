import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "@releasedesk/core";
import { releaseIntelForPullRequest } from "./release-intel-pr";
import { UNTRUSTED_BEGIN } from "./release-intel-diff";

const KEY = "lead-exclusive-test-key";
const PATCH = "@@ -1,1 +1,2 @@\n context\n+confirm test gate stays human\n";

function githubResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function grokContent(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    classify: { category: "routine_release_candidate", confidence: 0.8 },
    extract: ["risk tier"],
    score: { level: "medium", rationale: "new field" },
    summarize: "Adds riskTier. Human gates still required.",
    riskTier: "medium",
    blockers: [],
    injectionSuspected: false,
    injectionReason: "",
    ...over,
  });
}

describe("releaseIntelForPullRequest", () => {
  it("throws when the Lead key is absent and does not call Grok", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      throw new Error(`unexpected ${input}`);
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
    expect(urls).toEqual([]);
  });

  it("calls Grok with the exclusive key and returns grounded path:line blockers", async () => {
    let grokAuth = "";
    let user = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (url.endsWith("/pulls/7")) return githubResponse({ title: "Ship intel" });
        return githubResponse([{ filename: "apps/releasedesk/src/lib/grok-release-intel.ts", patch: PATCH }]);
      }
      grokAuth = new Headers(init?.headers).get("authorization") ?? "";
      const body = JSON.parse(String(init?.body)) as {
        response_format?: { json_schema?: { strict?: boolean } };
        messages: Array<{ content: string }>;
      };
      expect(body.response_format?.json_schema?.strict).toBe(true);
      user = body.messages[1]?.content ?? "";
      return githubResponse({
        choices: [
          {
            message: {
              content: grokContent({
                blockers: [
                  {
                    path: "apps/releasedesk/src/lib/grok-release-intel.ts",
                    line: 2,
                    evidence: "confirm test gate stays human",
                    severity: "medium",
                  },
                  { path: "B1", line: 1, evidence: "B1", severity: "high" },
                ],
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
    expect(report.schema).toBe("release-intel.v2");
    expect(report.label).toBe("LIVE");
    expect(report.intel.riskTier).toBe("medium");
    expect(report.intel.blockers).toEqual(["apps/releasedesk/src/lib/grok-release-intel.ts:2"]);
    expect(report.intel.droppedUngrounded.map((item) => item.path)).toEqual(["B1"]);
    expect(user).toContain(UNTRUSTED_BEGIN);
    expect(user).toContain("Ship intel");
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

  it("fails visibly when the diff cannot be fetched", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/pulls/36")) return githubResponse({ title: "T" });
      return githubResponse({ message: "no" }, false, 502);
    };
    await expect(
      releaseIntelForPullRequest({
        fetchImpl,
        env: {
          GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
          PR_NUMBER: "36",
          GITHUB_TOKEN: "ghs_test",
          RELEASEDESK_GROK_API_KEY_LEAD: KEY,
        },
      }),
    ).rejects.toThrow(/GitHub files request failed \(502\)/);
  });
});

describe("releaseIntelForPullRequest head commit and telemetry", () => {
  const HEAD = "5bddf362221b88d9d52b829f5fb84b2cdc17577e";
  const grokReply = {
    model: "grok-4.3",
    choices: [
      {
        finish_reason: "stop",
        message: { content: grokContent({ riskTier: "medium", summarize: "s", score: { level: "medium", rationale: "r" }, extract: [] }) },
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
  };

  function fetchWith(files: Array<{ filename: string; patch?: string }>, headSha: string | undefined): {
    fetchImpl: typeof fetch;
    sent: () => string;
  } {
    let user = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (/\/pulls\/41$/.test(url)) return githubResponse({ title: "T", head: headSha ? { sha: headSha } : {} });
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        if (page > 1) return githubResponse([]);
        return githubResponse(files);
      }
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      user = body.messages[1]?.content ?? "";
      return githubResponse(grokReply);
    };
    return { fetchImpl, sent: () => user };
  }

  const baseEnv = {
    GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
    PR_NUMBER: "41",
    GITHUB_TOKEN: "ghs_test",
    RELEASEDESK_GROK_API_KEY_LEAD: KEY,
  };

  it("takes headSha from the GitHub pull request", async () => {
    const { fetchImpl } = fetchWith([{ filename: "a.ts", patch: PATCH }], HEAD);
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: baseEnv,
      now: () => new Date("2026-11-26T05:00:00Z"),
    });
    expect(report.schema).toBe("release-intel.v2");
    expect(report.headSha).toBe(HEAD);
    expect(report.headShaSource).toBe("github");
    expect(report.generatedAt).toBe("2026-11-26T05:00:00.000Z");
    expect(report.intel.model).toBe("grok-4.3");
    expect(report.intel.telemetry.promptTokens).toBe(500);
  });

  it("prefers PR_HEAD_SHA from the workflow event over the API", async () => {
    const eventSha = "4160579fee57448d37564fd92ca1321fafbac962";
    const { fetchImpl } = fetchWith([{ filename: "a.ts", patch: PATCH }], HEAD);
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: { ...baseEnv, PR_HEAD_SHA: eventSha.toUpperCase() },
    });
    expect(report.headSha).toBe(eventSha);
    expect(report.headShaSource).toBe("env");
  });

  it("says the sha is unavailable rather than guessing one", async () => {
    const { fetchImpl } = fetchWith([{ filename: "a.ts" }], undefined);
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: { ...baseEnv, PR_HEAD_SHA: "not-a-sha" },
    });
    expect(report.headSha).toBeNull();
    expect(report.headShaSource).toBe("unavailable");
  });

  it("sends every changed file when the diff fits, with no 40-file cap", async () => {
    const files = Array.from({ length: 48 }, (_, i) => ({ filename: `apps/kyc/f${i}.ts`, patch: PATCH }));
    const { fetchImpl, sent } = fetchWith(files, HEAD);
    const report = await releaseIntelForPullRequest({ fetchImpl, env: baseEnv });
    expect(report.filesTotal).toBe(48);
    expect(report.filesSent).toBe(48);
    expect(report.diffTruncated).toBe(false);
    expect(sent()).toContain("apps/kyc/f47.ts");
    expect(sent()).toContain("filesSent=48 filesTotal=48");
  });

  it("paginates the file list and reports truncation when the token budget is small", async () => {
    const pages: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        if (/\/pulls\/41$/.test(url)) return githubResponse({ title: "T", head: { sha: HEAD } });
        const page = Number(new URL(url).searchParams.get("page"));
        pages.push(page);
        const count = page === 1 ? 100 : 5;
        return githubResponse(
          Array.from({ length: count }, (_, i) => ({
            filename: `p${page}-${i}.ts`,
            patch: PATCH,
          })),
        );
      }
      void init;
      return githubResponse(grokReply);
    };
    const report = await releaseIntelForPullRequest({
      fetchImpl,
      env: { ...baseEnv, RELEASE_INTEL_DIFF_TOKEN_BUDGET: "256" },
    });
    expect(pages).toEqual([1, 2]);
    expect(report.filesTotal).toBe(105);
    expect(report.filesSent).toBeLessThan(105);
    expect(report.diffTruncated).toBe(true);
  });
});
