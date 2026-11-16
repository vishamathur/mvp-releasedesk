import { describe, expect, it } from "vitest";
import type { CloudAgentHandoff } from "../builder-types.js";
import { createMockCloudAgentClient } from "./mock-client.js";
import { dispatchCloudAgentPipeline } from "./dispatch.js";
import { resolveCloudAgentClient, resolveCloudAgentClientForKind } from "./resolve.js";
import type { CloudAgentClient, CloudAgentDispatchRequest, CloudAgentKind } from "./types.js";

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
    expect(pipeline.handoffs.every((h) => h.metadata.cloudAgentApi === "mock")).toBe(true);

    const kinds = pipeline.results.map((r) => r.agentKind).sort();
    expect(kinds).toEqual(["coding", "review", "testing"]);
    expect(pipeline.results.every((r) => r.mocked)).toBe(true);
    expect(pipeline.results.every((r) => r.summary.startsWith("MOCK:"))).toBe(true);

    const actions = pipeline.audit.map((e) => e.action);
    expect(actions[0]).toBe("cloud_agent.pipeline_start");
    expect(actions).toContain("cloud_agent.dispatch");
    expect(actions).toContain("cloud_agent.completed");
    expect(actions.at(-1)).toBe("cloud_agent.pipeline_end");
    expect(pipeline.audit.some((e) => e.data?.autoMerge === false)).toBe(true);
  });

  it("retries failed Coding dispatch then succeeds", async () => {
    const client = createMockCloudAgentClient({
      failUntilAttempt: { coding: 1 },
    });
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      client,
      maxAttempts: 2,
    });

    expect(pipeline.codingOk).toBe(true);
    expect(pipeline.allOk).toBe(true);

    const codingAttempts = pipeline.attempts.filter((a) => a.agentKind === "coding");
    expect(codingAttempts).toHaveLength(2);
    expect(codingAttempts[0]!.outcome).toBe("retrying");
    expect(codingAttempts[1]!.outcome).toBe("completed");
    expect(pipeline.audit.some((e) => e.action === "cloud_agent.retrying")).toBe(true);
  });

  it("skips Testing/Review when Coding exhausts retries", async () => {
    const client = createMockCloudAgentClient({
      failUntilAttempt: { coding: 5 },
    });
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      client,
      maxAttempts: 2,
    });

    expect(pipeline.codingOk).toBe(false);
    expect(pipeline.allOk).toBe(false);
    expect(pipeline.handoffs.find((h) => h.agentKind === "coding")!.status).toBe("failed");
    expect(pipeline.handoffs.find((h) => h.agentKind === "testing")!.status).toBe("failed");
    expect(pipeline.handoffs.find((h) => h.agentKind === "review")!.status).toBe("failed");
    expect(pipeline.audit.filter((e) => e.action === "cloud_agent.skipped")).toHaveLength(2);
    expect(pipeline.results).toHaveLength(1); // coding only
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

describe("resolveCloudAgentClient", () => {
  it("defaults to MOCK without RELEASEDESK_CLOUD_CLIENT=real", () => {
    const client = resolveCloudAgentClient({
      env: { CURSOR_API_KEY: "secret-but-ignored" },
    });
    expect(client.mode).toBe("mock");
  });

  it("uses unavailable stub when real requested without exclusive key", async () => {
    const client = resolveCloudAgentClient({
      mode: "real",
      env: { CURSOR_API_KEY: "shared-only" },
    });
    expect(client.mode).toBe("real");
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
    expect(result.status).toBe("failed");
    expect(result.mocked).toBe(true);
    expect(result.summary.startsWith("MOCK:")).toBe(true);
  });

  it("honors injected client", () => {
    const injected = createMockCloudAgentClient();
    const client = resolveCloudAgentClient({
      mode: "real",
      env: { CURSOR_API_KEY: "x", RELEASEDESK_CLOUD_CLIENT: "real" },
      client: injected,
    });
    expect(client).toBe(injected);
  });
});

describe("dispatchCloudAgentPipeline per-agent keys", () => {
  it("resolves a distinct client per agentKind via resolveClient", async () => {
    const seen: CloudAgentKind[] = [];
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      resolveClient: (kind) => {
        seen.push(kind);
        return createMockCloudAgentClient();
      },
      maxAttempts: 1,
    });
    expect(pipeline.allOk).toBe(true);
    expect(seen).toEqual(expect.arrayContaining(["coding", "testing", "review"]));
    expect(new Set(seen).size).toBe(3);
  });

  it("coding exclusive key does not unlock testing in env resolve path", async () => {
    const env = {
      RELEASEDESK_CLOUD_CLIENT: "real",
      RELEASEDESK_CURSOR_API_KEY_CODING: "coding-key",
    };
    const codingClient = resolveCloudAgentClientForKind("coding", { env, mode: "real" });
    const testingClient = resolveCloudAgentClientForKind("testing", { env, mode: "real" });
    expect(codingClient.mode).toBe("real");

    const testingResult = await testingClient.dispatch({
      handoffId: "t",
      agentKind: "testing",
      prompt: "x",
      repository: "owner/repo",
      baseBranch: "main",
      proposedBranch: "cursor/x",
      acceptanceCriteria: [],
      autoMerge: false,
    });
    expect(testingResult.mocked).toBe(true);
    expect(testingResult.error).toMatch(/TESTING/);

    const kinds: CloudAgentKind[] = [];
    const pipeline = await dispatchCloudAgentPipeline(plannedHandoffs(), {
      resolveClient: (kind) => {
        kinds.push(kind);
        return resolveCloudAgentClientForKind(kind, {
          env,
          mode: "mock",
        });
      },
      maxAttempts: 1,
    });
    expect(pipeline.allOk).toBe(true);
    expect(kinds).toEqual(expect.arrayContaining(["coding", "testing", "review"]));
  });
});
