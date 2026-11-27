import { describe, expect, it } from "vitest";
import { addedPatch } from "./diff.js";
import { renderOwaspReviewComment } from "./comment.js";
import { OWASP_REVIEW_KEY_ENV_LEAD, reviewDiff } from "./review.js";
import {
  extractBuilderDisputes,
  extractPriorReview,
  manualReviewRequested,
  owaspReviewForPullRequest,
} from "./pr.js";
import type { DiffFile } from "./types.js";

function file(path: string, lines: readonly string[]): DiffFile {
  return { path, patch: addedPatch(lines) };
}

const passX01 = {
  id: "X01",
  verdict: "PASS",
  confidence: 0.9,
  path: "",
  line: 0,
  evidence: "",
  severity: "none",
  autoFixable: true,
  suggestedFix: { what: "", where: "", why: "", owaspId: "X01" },
};

describe("pull request review", () => {
  it("reviews every diff, including a cloud-agent branch name and a request id in the title", async () => {
    const report = await owaspReviewForPullRequest({
      env: {
        GITHUB_TOKEN: "gh-test-token",
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        GITHUB_HEAD_REF: "cursor/req-99-anything",
        PR_NUMBER: "12",
        PR_HEAD_SHA: "abcdef1234567",
        PR_TITLE: "REQ-99 sample change",
        RELEASEDESK_GROK_API_KEY_LEAD: "lead-owasp-test-key",
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("/pulls/12/files")) {
          return Response.json([
            { filename: "src/format.ts", status: "added", patch: addedPatch(["export const n = 1;"]) },
          ]);
        }
        if (href.includes("/pulls/12")) {
          return Response.json({
            title: "REQ-99 sample change",
            head: { sha: "abcdef1234567" },
            labels: [],
          });
        }
        if (href.includes("/issues/12/comments")) return Response.json([]);
        if (href.includes("api.x.ai")) {
          return Response.json({
            model: "grok-4.3",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ controls: [passX01] }) } }],
            usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
          });
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    expect(report.outcome).toBe("auto-proceed");
    expect(report.keyEnvVar).toBe(OWASP_REVIEW_KEY_ENV_LEAD);
    expect(report.headSha).toBe("abcdef1234567");
  });

  it("treats the manual-review label as an exception and still runs the review", async () => {
    const report = await owaspReviewForPullRequest({
      env: {
        GITHUB_TOKEN: "gh-test-token",
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        PR_NUMBER: "12",
        PR_HEAD_SHA: "abcdef1234567",
        RELEASEDESK_GROK_API_KEY_LEAD: "lead-owasp-test-key",
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("/pulls/12/files")) {
          return Response.json([
            { filename: "src/format.ts", status: "added", patch: addedPatch(["export const n = 1;"]) },
          ]);
        }
        if (href.includes("/pulls/12")) {
          return Response.json({
            title: "format",
            head: { sha: "abcdef1234567" },
            labels: [{ name: "security-manual-review" }],
          });
        }
        if (href.includes("/issues/12/comments")) return Response.json([]);
        if (href.includes("api.x.ai")) {
          return Response.json({
            choices: [{ message: { content: JSON.stringify({ controls: [passX01] }) } }],
          });
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    expect(report.outcome).toBe("needs-human");
    expect(report.exceptions[0]?.type).toBe("MANUAL_REQUESTED");
    expect(manualReviewRequested(["security-manual-review"], {}).requested).toBe(true);
    expect(manualReviewRequested([], { OWASP_MANUAL_REVIEW: "1" }).reason).toMatch(/OWASP_MANUAL_REVIEW/);
  });

  it("reads a Builder dispute and prior failure rounds from comments", () => {
    const prior = reviewDiff(
      {
        repository: "vishamathur/mvp-releasedesk",
        pullRequest: 12,
        headSha: "1111111aaaa",
        title: "earlier",
        files: [file("src/format.ts", ["export const n = 1;"])],
        generatedAt: "2026-11-27T00:00:00.000Z",
      },
      {
        ok: true,
        payload: { controls: [passX01] },
        requestedModel: "grok-4.3",
        servedModel: "grok-4.3",
        telemetry: {
          requestedModel: "grok-4.3",
          servedModel: "grok-4.3",
          promptTokens: 1,
          completionTokens: 1,
          reasoningTokens: null,
          totalTokens: 2,
          cachedPromptTokens: null,
          costInUsdTicks: null,
          latencyMs: 1,
          estUsd: null,
          estNote: "usage not reported by the API",
          billedCostUsd: null,
          billedNote: "billed cost not reported",
        },
      },
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
    const stored = { ...prior, failureRounds: { X01: 2 } };
    const comment = renderOwaspReviewComment(stored);
    expect(extractPriorReview([comment])).toEqual({ headSha: "1111111aaaa", failureRounds: { X01: 2 } });
    const dispute = `<!-- owasp-builder-dispute:v1\n{ "disputes": [{ "id": "X01", "disputed": true, "reason": "needed for the fixture", "path": "src/format.ts", "line": 1 }] }\n-->`;
    expect(extractBuilderDisputes([dispute])).toEqual([
      {
        id: "X01",
        disputed: true,
        reason: "needed for the fixture",
        path: "src/format.ts",
        line: 1,
      },
    ]);
  });

  it("does not auto-proceed when the diff cannot be read", async () => {
    const report = await owaspReviewForPullRequest({
      env: {
        GITHUB_TOKEN: "gh-test-token",
        GITHUB_REPOSITORY: "vishamathur/mvp-releasedesk",
        PR_NUMBER: "12",
        PR_HEAD_SHA: "abcdef1234567",
        RELEASEDESK_GROK_API_KEY_LEAD: "lead-owasp-test-key",
      },
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("/pulls/12/files")) return new Response("no", { status: 500 });
        if (href.includes("/pulls/12")) {
          return Response.json({ title: "format", head: { sha: "abcdef1234567" }, labels: [] });
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    expect(report.status).toBe("failed");
    expect(report.outcome).toBe("needs-human");
    expect(report.exceptions[0]?.type).toBe("REVIEW_FAILED");
    expect(report.outcome).not.toBe("auto-proceed");
  });
});
