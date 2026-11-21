import { describe, expect, it } from "vitest";
import { evaluateIterationProceedGate } from "../ai-red-teaming/checkpoint-gate.js";
import { GROK_BOT_ORDER } from "../grok-bots/load.js";
import { SUB_AGENT_CATALOG, listSubAgentCatalog } from "./catalog.js";
import {
  bindChild,
  delegateToChildren,
  mergeSubAgentAggregates,
  rollupSubAgentResults,
  type SubAgentChildResult,
} from "./delegate.js";
import { SubAgentChildResultSchema, type ParentBotId } from "./schema.js";

function ok(summary: string, payload: Record<string, unknown> = {}) {
  return async () => ({ summary, payload });
}

describe("delegateToChildren", () => {
  it("runs a parallel group together and a later group after it", async () => {
    let started = 0;
    let overlap = false;
    const parallel = async (label: string) => {
      started += 1;
      await Promise.resolve();
      if (started >= 2) overlap = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { summary: label, payload: { label } };
    };

    const aggregate = await delegateToChildren({
      parentId: "change_analyst",
      context: {},
      children: [
        bindChild("change_analyst", "change_analyst.er-intake", () => parallel("intake")),
        bindChild("change_analyst", "change_analyst.diff-impact", () => parallel("diff")),
        bindChild("change_analyst", "change_analyst.estimation", (_ctx, prior) => {
          const diff = prior.find((child) => child.id === "change_analyst.diff-impact");
          return Promise.resolve({
            summary: "estimated",
            payload: { sawDiff: diff?.payload.label === "diff" },
          });
        }),
      ],
    });

    expect(overlap).toBe(true);
    expect(aggregate.status).toBe("completed");
    expect(aggregate.completedIds).toEqual([
      "change_analyst.er-intake",
      "change_analyst.diff-impact",
      "change_analyst.estimation",
    ]);
    const estimation = aggregate.children.find((child) => child.id === "change_analyst.estimation");
    expect(estimation?.payload.sawDiff).toBe(true);
  });

  it("fails the parent when a required child throws", async () => {
    const aggregate = await delegateToChildren({
      parentId: "standards",
      context: {},
      children: [
        bindChild("standards", "standards.policy-rules", async () => {
          throw new Error("policy corpus unreadable");
        }),
        bindChild("standards", "standards.docs-conventions", ok("conventions ok")),
      ],
    });

    expect(aggregate.status).toBe("failed");
    expect(aggregate.failedIds).toEqual(["standards.policy-rules"]);
    expect(aggregate.completedIds).toEqual(["standards.docs-conventions"]);
    expect(aggregate.securityGateHeld).toBe(false);
    expect(aggregate.children.find((child) => child.id === "standards.policy-rules")?.error).toContain(
      "policy corpus unreadable",
    );
  });

  it("keeps a partial aggregate when only an optional child fails", async () => {
    const aggregate = await delegateToChildren({
      parentId: "builder",
      context: {},
      children: [
        {
          ...bindChild("builder", "builder.backend-api", ok("api planned")),
          required: false,
          run: async () => {
            throw new Error("optional layer missed");
          },
        },
        bindChild("builder", "builder.frontend-ui", ok("ui planned")),
        bindChild("builder", "builder.tests-ci", ok("tests planned")),
      ],
    });

    expect(aggregate.status).toBe("partial");
    expect(aggregate.failedIds).toEqual(["builder.backend-api"]);
    expect(aggregate.securityGateHeld).toBe(false);
  });

  it("times out a child and fail-closes security without approving the iteration gate", async () => {
    const aggregate = await delegateToChildren({
      parentId: "security",
      context: {},
      now: Date.now,
      children: [
        bindChild("security", "security.secret-scan", ok("no secrets"), { timeoutMs: 40 }),
        bindChild(
          "security",
          "security.dependency-cve",
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ summary: "too late", payload: {} }), 200);
            }),
          { timeoutMs: 40 },
        ),
        bindChild("security", "security.red-team-prompts", ok("prompts clear"), { timeoutMs: 40 }),
      ],
    });

    expect(aggregate.status).toBe("failed");
    expect(aggregate.timedOutIds).toEqual(["security.dependency-cve"]);
    expect(aggregate.securityGateHeld).toBe(true);
    expect(aggregate.completedIds.sort()).toEqual([
      "security.red-team-prompts",
      "security.secret-scan",
    ]);
    expect(aggregate).not.toHaveProperty("canProceed");
    expect(aggregate).not.toHaveProperty("approvals");

    const gate = evaluateIterationProceedGate({
      iterationId: "iter-sub-agents",
      approvals: [],
    });
    expect(gate.mandatoryApproval).toBe(true);
    expect(gate.canProceed).toBe(false);
    expect(gate.satisfied).toBe(false);
    expect(gate.hasRedTeamApproval).toBe(false);
    expect(gate.hasSecurityApproval).toBe(false);
  });

  it("treats a skipped required security child as fail-closed", () => {
    const skipped: SubAgentChildResult = SubAgentChildResultSchema.parse({
      id: "security.secret-scan",
      parentId: "security",
      responsibility: "Scan change input for private keys and hardcoded credentials.",
      status: "skipped",
      summary: "skipped",
      payload: {},
      durationMs: 1,
      required: true,
      parallelGroup: 0,
    });
    const aggregate = rollupSubAgentResults("security", [skipped]);
    expect(aggregate.status).toBe("failed");
    expect(aggregate.securityGateHeld).toBe(true);
    expect(aggregate.skippedIds).toEqual(["security.secret-scan"]);
  });

  it("merges phased lead delegations", () => {
    const front = rollupSubAgentResults("lead", [
      SubAgentChildResultSchema.parse({
        id: "lead.intake-routing",
        parentId: "lead",
        responsibility: SUB_AGENT_CATALOG.lead[0]!.responsibility,
        status: "completed",
        summary: "routed",
        payload: { track: "er_sprint" },
        durationMs: 1,
        required: true,
        parallelGroup: 0,
      }),
    ]);
    const back = rollupSubAgentResults("lead", [
      SubAgentChildResultSchema.parse({
        id: "lead.release-aggregation",
        parentId: "lead",
        responsibility: SUB_AGENT_CATALOG.lead[2]!.responsibility,
        status: "completed",
        summary: "aggregated",
        payload: {},
        durationMs: 1,
        required: true,
        parallelGroup: 2,
      }),
    ]);
    const merged = mergeSubAgentAggregates("lead", [front, back]);
    expect(merged.status).toBe("completed");
    expect(merged.children.map((child) => child.id)).toEqual([
      "lead.intake-routing",
      "lead.release-aggregation",
    ]);
    expect(merged.securityGateHeld).toBe(false);
  });
});

describe("sub-agent catalog", () => {
  it("keeps children under the five parents and out of the top-level roster", () => {
    const parents = Object.keys(SUB_AGENT_CATALOG).sort();
    expect(parents).toEqual(["builder", "change_analyst", "lead", "security", "standards"]);
    expect([...GROK_BOT_ORDER]).toEqual([
      "lead",
      "change-analyst",
      "standards",
      "security",
      "builder",
    ]);

    const ids = listSubAgentCatalog().map((child) => child.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(GROK_BOT_ORDER as readonly string[]).not.toContain(id);
    }
    expect(SUB_AGENT_CATALOG.security.every((child) => child.required)).toBe(true);
    expect(SUB_AGENT_CATALOG.security.map((child) => child.parallelGroup)).toEqual([0, 0, 0]);

    const byParent = new Map<ParentBotId, number>();
    for (const child of listSubAgentCatalog()) {
      byParent.set(child.parentId, (byParent.get(child.parentId) ?? 0) + 1);
    }
    expect(byParent.get("lead")).toBe(3);
    expect(byParent.get("change_analyst")).toBe(3);
    expect(byParent.get("standards")).toBe(2);
    expect(byParent.get("security")).toBe(3);
    expect(byParent.get("builder")).toBe(3);
  });
});
