import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createChangeAnalystRunner } from "./change-analyst.js";
import { defaultWorkspaceRoot } from "./paths.js";

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main", headRef: "HEAD" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Change analysis",
    agentRole: "change_analyst",
    status: "running",
    input,
  });
  const started = await store.get(run.runId);
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "change_analyst",
    attempt: 0,
    run: started!,
    task,
  };
}

describe("ChangeAnalystRunner", () => {
  it("analyzes local git range and returns evidence-backed findings", async () => {
    const runner = createChangeAnalystRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "HEAD",
      focusPaths: [],
    });

    const result = await runner(inv);
    expect(result.status).toBe("completed");
    expect(result.payload.agentRole).toBe("change_analyst");
    expect(typeof result.payload.releaseNotesDraft).toBe("string");
    expect(Array.isArray(result.payload.findings)).toBe(true);
    expect((result.payload.findings as unknown[]).length).toBeGreaterThan(0);
    expect(result.evidence?.length).toBeGreaterThan(0);
    expect(["low", "medium", "high", "unknown"]).toContain(result.payload.overallImpact);
  });

  it("falls back to fixture synthesis when git range yields nothing useful", async () => {
    const runner = createChangeAnalystRunner({
      workspaceRoot: "/tmp/nonexistent-releasedesk-workspace",
      skipGrok: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "HEAD",
    });

    const result = await runner(inv);
    expect(result.status).toBe("completed");
    expect(result.summary.startsWith("MOCK:") || result.mocksUsed?.some((m) => m.mocked)).toBe(
      true,
    );
    expect((result.payload.findings as unknown[]).length).toBeGreaterThan(0);
    expect(result.evidence?.some((e) => e.kind === "artifact" || e.kind === "diff")).toBe(true);
  });
});
