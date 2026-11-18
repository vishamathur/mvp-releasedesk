import { describe, expect, it } from "vitest";
import {
  applyIterationSignOff,
  createPendingIterationGateDemo,
  recomputeIterationGate,
} from "./iteration-gate";

describe("iteration gate demo", () => {
  it("starts pending and opens after red_team approval", () => {
    const pending = createPendingIterationGateDemo();
    expect(recomputeIterationGate(pending).uiStatus).toBe("pending");
    expect(recomputeIterationGate(pending).gate.iterationProceed.canProceed).toBe(false);

    const approved = applyIterationSignOff(pending, {
      decision: "approved",
      kind: "red_team",
      decidedBy: "rt@northwind",
    });
    const view = recomputeIterationGate(approved);
    expect(view.uiStatus).toBe("open");
    expect(view.gate.nextMainStage).toBe("human_merge_release");
    expect(view.gate.remediationSideQueue.every((i) => i.nonBlocking)).toBe(true);
  });

  it("blocks when sign-off is rejected", () => {
    const pending = createPendingIterationGateDemo();
    const rejected = applyIterationSignOff(pending, {
      decision: "rejected",
      decidedBy: "dm@northwind",
    });
    const view = recomputeIterationGate(rejected);
    expect(view.uiStatus).toBe("blocked");
    expect(view.gate.iterationProceed.canProceed).toBe(false);
  });

  it("opens with security approval alone", () => {
    const pending = createPendingIterationGateDemo();
    const approved = applyIterationSignOff(pending, {
      decision: "approved",
      kind: "security",
      decidedBy: "sec@northwind",
    });
    expect(recomputeIterationGate(approved).uiStatus).toBe("open");
  });
});
