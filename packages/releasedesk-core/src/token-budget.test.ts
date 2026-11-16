import { describe, expect, it } from "vitest";
import { createEvidenceItem } from "./evidence.js";
import { createRunContext } from "./run-context.js";
import { createTaskRecord } from "./task.js";
import {
  buildRoleContextSlice,
  compareFullRunVsSlice,
  estimateTokensFromText,
} from "./token-budget.js";

describe("token-budget", () => {
  it("estimates tokens as ceil(chars/4)", () => {
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
  });

  it("slice is leaner than full run packing", () => {
    const run = createRunContext({
      goal: "Portfolio token check",
      target: { repository: "vishamathur/mvp-releasedesk" },
    });
    const security = createTaskRecord({
      runId: run.runId,
      name: "Security review",
      agentRole: "security",
      input: { scope: "full" },
    });
    security.status = "completed";
    security.output = {
      agentRole: "security",
      summary: "TLS ok; one advisory correlated",
      riskLevel: "medium",
      findings: [{ id: "f1", text: "pad ".repeat(200) }],
    };
    security.evidence = [
      createEvidenceItem({
        kind: "finding",
        title: "Security evidence",
        summary: "evidence pad ".repeat(80),
        source: "security",
      }),
    ];
    run.tasks.push(security);
    run.tasks.push(
      createTaskRecord({
        runId: run.runId,
        name: "Change analyst",
        agentRole: "change_analyst",
        input: { notes: "x".repeat(400) },
      }),
    );

    const slice = buildRoleContextSlice(run, "security");
    const cmp = compareFullRunVsSlice(run, slice);
    expect(cmp.sliceTokensEst).toBeLessThan(cmp.fullRunTokensEst);
    expect(cmp.savingsTokensEst).toBeGreaterThan(0);
    expect(cmp.savingsPct).toBeGreaterThan(0);
  });
});
