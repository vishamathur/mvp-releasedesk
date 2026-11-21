import { describe, expect, it } from "vitest";
import type { CloudAgentHandoff } from "../builder-types.js";
import { createMockCloudAgentClient } from "./mock-client.js";
import { dispatchCloudAgentPipeline } from "./dispatch.js";
import { resolveCloudAgentClient } from "./resolve.js";
import type { CloudAgentClient, CloudAgentDispatchRequest } from "./types.js";

function plannedHandoffs(repo = "vishamathur/mvp-releasedesk"): CloudAgentHandoff[] {
  const proposedBranch = "cursor/rd-remediation-test-b5af";
  return (["coding", "testing", "review"] as const).map((agentKind) => ({
    agentKind,
    handoffId: `handoff_${agentKind}_t1`,
    status: "planned" as const,
    prompt: `Do ${agentKind}`,
    repository: repo,
    baseBranch: "main",
    proposedBranch,
    acceptanceCriteria: ["ok"],
    relatedEvidenceIds: [],
    metadata: { branch: proposedBranch, cloudAgentApi: "not_wired" as const },
  }));
}

describe("Mock Cloud Agent client + dispatch pipeline", () => {
  it("dispatches Coding then Testing/Review and tracks branch/tests/PR", async () => {
    const client = createMockCloudAgentClient();
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      client,
      maxAttempts: 2,
    });

    expect(client.mode).toBe("mock");
    expect(pipeline.codingOk).toBe(true);
    expect(pipeline.allOk).toBe(true);
    expect(pipeline.proposedBranch).toContain("cursor/rd-remediation-");
    expect(pipeline.proposedPrUrl).toMatch(/^https:\/\/github\.com\//);
    expect(pipeline.testsPassed).toBe(true);
    expect(pipeline.handoffs.map((h) => h.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(pipeline.results.map((r) => r.agentKind).sort()).toEqual([
      "coding",
      "review",
      "testing",
    ]);
  });

  it("retries failed Coding dispatch then succeeds", async () => {
    const client = createMockCloudAgentClient({ failUntilAttempt: { coding: 1 } });
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      client,
      maxAttempts: 2,
    });
    expect(pipeline.codingOk).toBe(true);
    const codingAttempts = pipeline.attempts.filter((a) => a.agentKind === "coding");
    expect(codingAttempts.map((a) => a.outcome)).toEqual(["retrying", "completed"]);
  });

  it("skips Testing/Review when Coding exhausts retries", async () => {
    const client = createMockCloudAgentClient({ failUntilAttempt: { coding: 5 } });
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      client,
      maxAttempts: 2,
    });
    expect(pipeline.codingOk).toBe(false);
    expect(pipeline.handoffs.find((h) => h.agentKind === "testing")!.status).toBe("failed");
    expect(pipeline.handoffs.find((h) => h.agentKind === "review")!.status).toBe("failed");
    expect(pipeline.audit.filter((e) => e.action === "cloud_agent.skipped")).toHaveLength(2);
  });

  it("never allows autoMerge on dispatch requests", async () => {
    const seen: CloudAgentDispatchRequest[] = [];
    const wrapping: CloudAgentClient = {
      mode: "mock",
      async dispatch(req) {
        seen.push(req);
        return createMockCloudAgentClient().dispatch(req);
      },
    };
    await dispatchCloudAgentPipeline(plannedHandoffs(), { client: wrapping });
    expect(seen.length).toBe(3);
    expect(seen.every((r) => r.autoMerge === false)).toBe(true);
  });
});

describe("resolveCloudAgentClient — Desk does not go live", () => {
  it("defaults to MOCK even when shared CURSOR_API_KEY is set", () => {
    const client = resolveCloudAgentClient({
      env: { CURSOR_API_KEY: "shared-must-not-use" },
    });
    expect(client.mode).toBe("mock");
  });

  it("stays MOCK when real mode and per-bot Cursor keys are set", async () => {
    const client = resolveCloudAgentClient({
      mode: "real",
      env: {
        RELEASEDESK_CURSOR_API_KEY_CODING: "coding-exclusive",
        RELEASEDESK_CURSOR_API_KEY_TESTING: "testing-exclusive",
        RELEASEDESK_CURSOR_API_KEY_REVIEW: "review-exclusive",
        CURSOR_API_KEY: "shared-ignored",
        RELEASEDESK_CLOUD_CLIENT: "real",
      },
    });
    expect(client.mode).toBe("mock");
    const result = await client.dispatch({
      handoffId: "h1",
      agentKind: "coding",
      prompt: "x",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(result.mocked).toBe(true);
    expect(result.status).not.toBe("failed");
  });

  it("fails only the kind whose exclusive key is missing", async () => {
    const { createRealCloudAgentClient } = await import("./real-client.js");
    const client = createRealCloudAgentClient({
      resolveApiKeyForKind: (kind) => (kind === "coding" ? "coding-exclusive" : undefined),
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });

    const coding = await client.dispatch({
      handoffId: "c1",
      agentKind: "coding",
      prompt: "ship",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    // Key present → real attempt (HTTP fail), not missing-key MOCK
    expect(coding.error).not.toMatch(/missing RELEASEDESK_CURSOR_API_KEY_CODING/);
    expect(coding.mocked).toBe(false);

    const testing = await client.dispatch({
      handoffId: "t1",
      agentKind: "testing",
      prompt: "verify",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(testing.status).toBe("failed");
    expect(testing.mocked).toBe(true);
    expect(testing.error).toContain("RELEASEDESK_CURSOR_API_KEY_TESTING");
  });
});
