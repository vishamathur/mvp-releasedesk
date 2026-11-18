import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createSecurityRunner } from "./security.js";
import { correlateAdvisories, loadAdvisoryCorpus } from "./advisories.js";
import { defaultWorkspaceRoot, sampleAdvisoriesPath } from "./paths.js";

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Security review",
    agentRole: "security",
    status: "running",
    input,
  });
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "security",
    attempt: 0,
    run: (await store.get(run.runId))!,
    task,
  };
}

describe("SecurityRunner", () => {
  it("loads sample advisories and correlates informational next advisory", async () => {
    const corpus = await loadAdvisoryCorpus(sampleAdvisoriesPath());
    expect(corpus.advisories.length).toBeGreaterThan(0);

    const runner = createSecurityRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      components: [],
      advisoryHints: [],
    });

    const result = await runner(inv);
    expect(result.status).toBe("completed");
    expect(result.payload.agentRole).toBe("security");
    expect(result.mocksUsed?.some((m) => m.mockLabel === "advisory-api")).toBe(true);
    // next is present in apps/kyc — informational, not release-blocking
    expect(result.payload.releaseBlockingCount).toBe(0);
    const findings = result.payload.findings as Array<{ component?: string; releaseBlocking: boolean }>;
    expect(findings.some((f) => f.component === "next")).toBe(true);
    expect(findings.every((f) => !f.releaseBlocking)).toBe(true);
  });

  it("flags release-blocking risks when evil-lib is in components", async () => {
    const runner = createSecurityRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
      extraComponents: [{ name: "evil-lib", version: "1.0.0", ecosystem: "npm" }],
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      components: [{ name: "evil-lib", version: "1.0.0" }],
    });

    const result = await runner(inv);
    expect((result.payload.releaseBlockingCount as number) > 0).toBe(true);
    expect(["high", "critical"]).toContain(result.payload.riskLevel);
  });

  it("correlateAdvisories respects version ranges", async () => {
    const corpus = await loadAdvisoryCorpus(sampleAdvisoriesPath());
    const hits = correlateAdvisories(corpus.advisories, [
      { name: "evil-lib", version: "9.9.9" },
    ]);
    expect(hits.some((h) => h.packageName === "evil-lib")).toBe(false);

    const vulnerable = correlateAdvisories(corpus.advisories, [
      { name: "evil-lib", version: "1.2.3" },
    ]);
    expect(vulnerable.some((h) => h.packageName === "evil-lib")).toBe(true);
  });
});
