import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createBuilderRunner, type CloudAgentHandoff } from "./builder.js";
import { createMockCloudAgentClient } from "./cloud/mock-client.js";

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Remediation (builder)",
    agentRole: "builder",
    status: "running",
    input,
  });
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "builder",
    attempt: 0,
    run: (await store.get(run.runId))!,
    task,
  };
}

describe("BuilderRunner + Cloud Agents", () => {
  it("dispatches Coding→Testing/Review via MOCK client and fills tracking fields", async () => {
    const runner = createBuilderRunner({
      skipGrok: true,
      cloudClient: createMockCloudAgentClient(),
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      remediationGoals: ["Remove evil-lib advisory exposure", "Add regression test"],
      baseBranch: "main",
      relatedFindings: [
        {
          sourceAgent: "security",
          summary: "evil-lib critical advisory",
          evidenceIds: ["ev_00000000-0000-4000-8000-000000000001"],
        },
      ],
    });

    const result = await runner(inv);
    expect(result.status).toBe("completed");
    expect(result.payload.agentRole).toBe("builder");
    expect(typeof result.payload.proposedBranch).toBe("string");
    expect(String(result.payload.proposedBranch)).toContain("cursor/rd-remediation-");
    expect(typeof result.payload.implementationInstructions).toBe("string");
    expect(String(result.payload.implementationInstructions)).toContain("Remove evil-lib");

    const handoffs = result.payload.cloudAgentHandoffs as CloudAgentHandoff[];
    expect(handoffs).toHaveLength(3);
    expect(handoffs.map((h) => h.agentKind).sort()).toEqual(["coding", "review", "testing"]);
    expect(handoffs.every((h) => h.status === "completed")).toBe(true);
    expect(handoffs.every((h) => h.metadata.cloudAgentApi === "mock")).toBe(true);

    const workItems = result.payload.workItems as Array<{
      status: string;
      kind: string;
      prUrl?: string;
    }>;
    expect(workItems.every((w) => w.status === "completed")).toBe(true);
    expect(workItems.find((w) => w.kind === "coding")?.prUrl).toMatch(/^https:\/\//);

    expect(result.payload.proposedPrUrl).toMatch(/^https:\/\/github\.com\//);
    expect(result.payload.testsPassed).toBe(true);

    const meta = result.payload.branchMetadata as {
      proposedBranch: string;
      testsPassed?: boolean;
      prUrl?: string;
      autoMerge?: boolean;
      humanMergeGateRequired?: boolean;
    };
    expect(meta.proposedBranch).toBe(result.payload.proposedBranch);
    expect(meta.testsPassed).toBe(true);
    expect(meta.prUrl).toBe(result.payload.proposedPrUrl);
    expect(meta.autoMerge).toBe(false);
    expect(meta.humanMergeGateRequired).toBe(true);

    expect(result.mocksUsed?.some((m) => m.mockLabel === "cursor-cloud-agents")).toBe(true);
    expect(result.summary.startsWith("MOCK:")).toBe(true);

    const audit = result.payload.cloudAgentAudit as Array<{ action: string }>;
    expect(audit.some((e) => e.action === "cloud_agent.pipeline_start")).toBe(true);
    expect(audit.some((e) => e.action === "cloud_agent.completed")).toBe(true);

    expect(result.evidence?.some((e) => e.kind === "pr_ref")).toBe(true);
    expect(result.evidence?.some((e) => e.title.includes("audit trail"))).toBe(true);
  });

  it("records retry evidence when MOCK client fails then recovers", async () => {
    const runner = createBuilderRunner({
      skipGrok: true,
      cloudMaxAttempts: 2,
      cloudClient: createMockCloudAgentClient({ failUntilAttempt: { coding: 1 } }),
    });
    const inv = await invocation({
      remediationGoals: ["Fix labeling"],
    });
    const result = await runner(inv);
    expect(result.payload.testsPassed).toBe(true);
    const attempts = result.payload.cloudAgentAttempts as Array<{
      agentKind: string;
      outcome: string;
    }>;
    expect(attempts.filter((a) => a.agentKind === "coding").map((a) => a.outcome)).toEqual([
      "retrying",
      "completed",
    ]);
  });

  it("can still plan-only when skipCloudDispatch is set", async () => {
    const runner = createBuilderRunner({ skipGrok: true, skipCloudDispatch: true });
    const inv = await invocation({ remediationGoals: ["Plan only"] });
    const result = await runner(inv);
    const handoffs = result.payload.cloudAgentHandoffs as CloudAgentHandoff[];
    expect(handoffs.every((h) => h.status === "planned")).toBe(true);
    expect(result.payload.testsPassed).toBeUndefined();
    expect(result.payload.proposedPrUrl).toBeUndefined();
  });
});
