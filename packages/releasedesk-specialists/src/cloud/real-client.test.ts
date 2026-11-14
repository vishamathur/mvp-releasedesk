import { describe, expect, it, vi } from "vitest";
import { createRealCloudAgentClient } from "./real-client.js";

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
