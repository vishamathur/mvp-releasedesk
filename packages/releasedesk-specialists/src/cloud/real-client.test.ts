import { describe, expect, it, vi } from "vitest";
import {
  createRealCloudAgentClient,
  resolveCursorApiKeyForAgent,
} from "./real-client.js";

describe("resolveCursorApiKeyForAgent", () => {
  it("never falls back to shared CURSOR_API_KEY", () => {
    expect(
      resolveCursorApiKeyForAgent("coding", {
        CURSOR_API_KEY: "shared",
        CURSOR_SERVICE_ACCOUNT_KEY: "sa",
      }),
    ).toBeUndefined();
    expect(
      resolveCursorApiKeyForAgent("testing", {
        RELEASEDESK_CURSOR_API_KEY_CODING: "coding-only",
        CURSOR_API_KEY: "shared",
      }),
    ).toBeUndefined();
  });

  it("reads exclusive kind key", () => {
    expect(
      resolveCursorApiKeyForAgent("review", {
        RELEASEDESK_CURSOR_API_KEY_REVIEW: "review-key",
        CURSOR_API_KEY: "shared",
      }),
    ).toBe("review-key");
  });
});

describe("createRealCloudAgentClient", () => {
  it("requires explicit per-agent apiKey or agentKind (no shared env fallback)", () => {
    const prev = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "shared-present";
    try {
      expect(() => createRealCloudAgentClient()).toThrow(/per-agent apiKey|agentKind/);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prev;
    }
  });
});

describe("Real Cloud Agent client (fetch stub)", () => {
  it("creates agent, polls to FINISHED, extracts branch and PR", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/agents") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.autoCreatePR).toBe(true);
        expect(body.prompt.text).toContain("Do NOT merge");
        return new Response(
          JSON.stringify({
            agent: { id: "bc-test-1", url: "https://cursor.com/agents/bc-test-1" },
            run: { id: "run-1", status: "CREATING" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/runs/run-1")) {
        return new Response(
          JSON.stringify({
            id: "run-1",
            agentId: "bc-test-1",
            status: "FINISHED",
            result: { text: "Implemented fix and opened PR" },
            git: {
              branches: [
                {
                  repoUrl: "github.com/vishamathur/mvp-releasedesk",
                  branch: "cursor/rd-remediation-fix-b5af",
                  prUrl: "https://github.com/vishamathur/mvp-releasedesk/pull/42",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const client = createRealCloudAgentClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
      pollTimeoutMs: 1000,
    });

    expect(client.mode).toBe("real");
    const result = await client.dispatch({
      handoffId: "handoff_coding_1",
      agentKind: "coding",
      prompt: "Fix retention labeling",
      repository: "vishamathur/mvp-releasedesk",
      baseBranch: "main",
      proposedBranch: "cursor/rd-remediation-fix-b5af",
      acceptanceCriteria: ["PR open", "no merge"],
      autoMerge: false,
    });

    expect(result.status).toBe("completed");
    expect(result.mocked).toBe(false);
    expect(result.branch).toBe("cursor/rd-remediation-fix-b5af");
    expect(result.prUrl).toBe("https://github.com/vishamathur/mvp-releasedesk/pull/42");
    expect(result.cloudAgentUrl).toContain("bc-test-1");
  });

  it("returns failed result on HTTP create error (retryable by pipeline)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const client = createRealCloudAgentClient({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.dispatch({
      handoffId: "h",
      agentKind: "testing",
      prompt: "test",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/503/);
  });
});
