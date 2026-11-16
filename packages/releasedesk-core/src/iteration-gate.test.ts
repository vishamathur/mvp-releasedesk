import { describe, expect, it } from "vitest";
import { evaluateIterationProceedGate } from "./iteration-gate.js";

describe("evaluateIterationProceedGate (#14)", () => {
  it("blocks when neither red_team nor security approval is present", () => {
    const gate = evaluateIterationProceedGate({
      iterationId: "iter_1",
      approvals: [],
    });
    expect(gate.mandatoryApproval).toBe(true);
    expect(gate.canProceed).toBe(false);
    expect(gate.satisfied).toBe(false);
    expect(gate.blockingIssue).toMatch(/red_team|security/i);
  });

  it("passes with red_team alone", () => {
    const gate = evaluateIterationProceedGate({
      iterationId: "iter_1",
      approvals: [
        {
          iterationId: "iter_1",
          kind: "red_team",
          approvedBy: "alice",
          approvedAt: "2026-11-16T12:00:00.000Z",
        },
      ],
    });
    expect(gate.canProceed).toBe(true);
    expect(gate.hasRedTeamApproval).toBe(true);
    expect(gate.hasSecurityApproval).toBe(false);
  });

  it("passes with security alone", () => {
    const gate = evaluateIterationProceedGate({
      iterationId: "iter_2",
      approvals: [
        {
          iterationId: "iter_2",
          kind: "security",
          approvedBy: "bob",
          approvedAt: "2026-11-16T12:00:00.000Z",
        },
      ],
    });
    expect(gate.canProceed).toBe(true);
    expect(gate.hasSecurityApproval).toBe(true);
  });

  it("ignores approvals for other iterations", () => {
    const gate = evaluateIterationProceedGate({
      iterationId: "iter_a",
      approvals: [
        {
          iterationId: "iter_b",
          kind: "security",
          approvedBy: "bob",
          approvedAt: "2026-11-16T12:00:00.000Z",
        },
      ],
    });
    expect(gate.canProceed).toBe(false);
  });
});
