import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createStandardsRunner } from "./standards.js";
import { defaultWorkspaceRoot, policiesDir } from "./paths.js";
import { loadPolicyCorpus } from "./policy-corpus.js";

async function invocation(
  input: Record<string, unknown>,
): Promise<AgentRunInvocation> {
  const store = createInMemoryStore();
  const run = await store.create({
    goal: "test",
    target: { repository: "vishamathur/mvp-releasedesk" },
  });
  const { task } = await store.addTask(run.runId, {
    name: "Standards compliance",
    agentRole: "standards",
    status: "running",
    input,
  });
  return {
    runId: run.runId,
    taskId: task.id,
    agentRole: "standards",
    attempt: 0,
    run: (await store.get(run.runId))!,
    task,
  };
}

describe("StandardsRunner", () => {
  it("loads Northwind policy fixtures and evaluates compliance", async () => {
    const corpus = await loadPolicyCorpus(policiesDir());
    expect(corpus.map((p) => p.id)).toEqual(
      expect.arrayContaining([
        "northwind-kyc-baseline",
        "northwind-data-retention",
        "northwind-auth-standards",
      ]),
    );

    const runner = createStandardsRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
      assumeLeadHumanGates: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      policyRefs: ["northwind-kyc-baseline", "northwind-auth-standards"],
    });

    const result = await runner(inv);
    expect(result.status).toBe("completed");
    expect(result.payload.agentRole).toBe("standards");
    expect(result.payload.compliant).toBe(true);
    expect(result.payload.policiesChecked).toEqual(
      expect.arrayContaining(["northwind-kyc-baseline", "northwind-auth-standards"]),
    );
    expect(result.evidence?.some((e) => e.kind === "policy_ref")).toBe(true);
  });

  it("reports deviations with evidence when change summary violates policy", async () => {
    const runner = createStandardsRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      skipGrok: true,
      assumeLeadHumanGates: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      policyRefs: ["northwind-kyc-baseline"],
      changeSummary: "Enable silent KYC auto-approve for all applicants",
    });

    const result = await runner(inv);
    expect(result.payload.compliant).toBe(false);
    const deviations = result.payload.deviations as Array<{ severity: string }>;
    expect(deviations.some((d) => d.severity === "critical")).toBe(true);
    expect(result.evidence?.some((e) => e.kind === "finding")).toBe(true);
  });
});
