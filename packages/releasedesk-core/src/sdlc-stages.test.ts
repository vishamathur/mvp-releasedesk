import { describe, expect, it } from "vitest";
import {
  assertTestingBeforeVerification,
  buildTestingStageResult,
  buildVerificationStageResult,
  parseSdlcStageRecord,
  SDLC_POST_CODING_ORDER,
} from "./sdlc-stages.js";

describe("SDLC Testing + Verification stages", () => {
  it("orders Testing before Verification", () => {
    expect(SDLC_POST_CODING_ORDER).toEqual(["testing", "verification"]);
  });

  it("treats Testing and Verification as distinct stage ids/kinds", () => {
    const testing = buildTestingStageResult({
      status: "passed",
      cycle: 1,
      evidence: { testingAgentRan: true, testsPassed: true },
    });
    const verification = buildVerificationStageResult({
      status: "passed",
      cycle: 1,
      evidence: {
        testingStageId: testing.id,
        testingStatus: testing.status,
        testingAgentRan: true,
        testsPassed: true,
        codingCompleted: true,
      },
    });
    expect(testing.stage).toBe("testing");
    expect(verification.stage).toBe("verification");
    expect(testing.id).not.toBe(verification.id);
    expect(verification.evidence.independentDecision).toBe(true);
  });

  it("enforces Testing before Verification in a cycle trail", () => {
    const testing = buildTestingStageResult({
      status: "passed",
      cycle: 2,
      evidence: { testingAgentRan: true, testsPassed: true },
    });
    const verification = {
      ...buildVerificationStageResult({
        status: "passed",
        cycle: 2,
        evidence: {
          testingStageId: testing.id,
          testingAgentRan: true,
          testsPassed: true,
          codingCompleted: true,
        },
      }),
      at: "2020-01-01T00:00:00.000Z",
    };
    const record = parseSdlcStageRecord({
      stages: [
        { ...testing, at: "2020-01-02T00:00:00.000Z" },
        verification,
      ],
    });
    expect(assertTestingBeforeVerification(record, 2)).toMatch(/precede/i);
  });
});
