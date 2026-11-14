import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createBuilderRunner, type CloudAgentHandoff } from "./builder.js";

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

describe("BuilderRunner", () => {
  it("produces implementation instructions and planned Cloud Agent handoffs", async () => {
    const runner = createBuilderRunner({ skipGrok: true });
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
    expect(handoffs.every((h) => h.status === "planned")).toBe(true);
    expect(handoffs.every((h) => h.metadata.cloudAgentApi === "not_wired")).toBe(true);

    const workItems = result.payload.workItems as Array<{ status: string; kind: string }>;
    expect(workItems.every((w) => w.status === "planned")).toBe(true);

    const meta = result.payload.branchMetadata as {
      proposedBranch: string;
      testsPassed?: boolean;
      prUrl?: string;
    };
    expect(meta.proposedBranch).toBe(result.payload.proposedBranch);
    expect(meta.testsPassed).toBeUndefined();
    expect(meta.prUrl).toBeUndefined();

    expect(result.mocksUsed?.some((m) => m.mockLabel === "cursor-cloud-agents")).toBe(true);
    expect(result.summary.startsWith("MOCK:")).toBe(true);
  });
});
