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
  it("dispatches Coding→Testing/Review via MOCK; Coding ships Grok intel path", async () => {
    const runner = createBuilderRunner({
      skipGrok: true,
      cloudClient: createMockCloudAgentClient(),
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      remediationGoals: ["Ship grok-release-intel classify+summarize"],
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

    const handoffs = result.payload.cloudAgentHandoffs as CloudAgentHandoff[];
    expect(handoffs).toHaveLength(3);
    expect(handoffs.map((h) => h.agentKind).sort()).toEqual(["coding", "review", "testing"]);
    expect(handoffs.every((h) => h.status === "completed")).toBe(true);

    const coding = handoffs.find((h) => h.agentKind === "coding")!;
    expect(coding.prompt).toContain("ship-grok-release-intel");
    expect(coding.prompt).toContain("grok-release-intel.ts");

    const testing = handoffs.find((h) => h.agentKind === "testing")!;
    expect(testing.prompt).toMatch(/VERIFY/i);
    expect(testing.prompt).toMatch(/Do NOT merge/i);

    const review = handoffs.find((h) => h.agentKind === "review")!;
    expect(review.prompt).toMatch(/REVIEW/i);
    expect(review.prompt).toMatch(/Do NOT approve merge/i);

    expect(result.payload.proposedPrUrl).toMatch(/^https:\/\/github\.com\//);
    expect(result.payload.testsPassed).toBe(true);
    expect(result.mocksUsed?.some((m) => m.mockLabel === "cursor-cloud-agents")).toBe(true);

    const meta = result.payload.branchMetadata as {
      autoMerge?: boolean;
      humanMergeGateRequired?: boolean;
    };
    expect(meta.autoMerge).toBe(false);
    expect(meta.humanMergeGateRequired).toBe(true);
  });

  it("records retry evidence when MOCK Coding fails then recovers", async () => {
    const runner = createBuilderRunner({
      skipGrok: true,
      cloudMaxAttempts: 2,
      cloudClient: createMockCloudAgentClient({ failUntilAttempt: { coding: 1 } }),
    });
    const inv = await invocation({ remediationGoals: ["Fix labeling"] });
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
    expect(handoffs).toHaveLength(3);
    expect(handoffs.every((h) => h.status === "planned")).toBe(true);
  });
});
