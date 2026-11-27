import { describe, expect, it } from "vitest";
import { createInMemoryStore, MissingCredentialError } from "@releasedesk/core";
import type { AgentRunInvocation } from "@releasedesk/lead";
import { createStandardsRunner } from "./standards.js";
import { defaultWorkspaceRoot, policiesDir } from "./paths.js";
import { evaluatePolicyDeviations, loadPolicyCorpus } from "./policy-corpus.js";

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
        "website-creation-template",
      ]),
    );

    const runner = createStandardsRunner({
      workspaceRoot: defaultWorkspaceRoot(),
      assumeLeadHumanGates: true,
    });
    const inv = await invocation({
      repository: "vishamathur/mvp-releasedesk",
      policyRefs: ["northwind-kyc-baseline", "northwind-auth-standards"],
    });
    await expect(runner(inv)).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("reports a critical deviation when the change text says KYC auto-approve", async () => {
    const policies = await loadPolicyCorpus(policiesDir());
    const deviations = evaluatePolicyDeviations({
      policies,
      changeSummary: "Enable silent KYC auto-approve for all applicants",
      repoSignals: { hasHumanApprovalGates: true },
    });
    expect(deviations.some((d) => d.severity === "critical")).toBe(true);
  });
});
