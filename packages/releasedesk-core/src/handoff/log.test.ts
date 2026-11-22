import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTrace } from "./log.js";
import { readLogDir } from "./log-dir.js";
import { loadProcessDefinitionsSync } from "./processes.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(workspaceRoot, "apps", "releasedesk", "test", "fixtures", "releasedesk-log");

describe("Release Desk Log JSONL", () => {
  const processes = loadProcessDefinitionsSync(workspaceRoot);

  it("reads the fixture directory, skips a bad line, and groups by request", () => {
    const read = readLogDir(fixtureDir);
    expect(read.requests["REQ-2026-0001"]?.length).toBeGreaterThan(10);
    expect(read.requests["REQ-2026-0002"]?.length).toBeGreaterThan(3);
    expect(read.requests["REQ-2026-0099"]).toHaveLength(1);
    expect(read.malformed.length).toBeGreaterThanOrEqual(2);
    expect(read.malformed.every((item) => item.file === "malformed.jsonl")).toBe(true);
    const seqs = read.requests["REQ-2026-0001"]!.map((line) => line.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("builds a PID-ER trace with owner gate decisions, a reject, and an anomaly", () => {
    const read = readLogDir(fixtureDir);
    const trace = buildTrace(read.requests["REQ-2026-0001"]!, processes);
    expect(trace.pid).toBe("PID-ER");
    expect(trace.pidVersion).toBe("1.1.0");
    expect(trace.currentStage).toBe("release-gate");
    expect(trace.gateDecisions.map((item) => `${item.gate}:${item.decidedBy}`)).toEqual([
      "finance-approval:Priya Shah",
      "security-compliance-approval:Avery Chen",
      "release-gate:Morgan Lee",
    ]);
    expect(trace.gateDecisions.every((item) => (item.verbatim ?? "").length > 0)).toBe(true);
    expect(trace.timeline.some((line) => line.event === "reject" && line.rejectCode === "bot_cannot_approve")).toBe(true);
    expect(trace.anomalies.some((item) => item.includes("copy seen from only one side"))).toBe(true);
    expect(trace.anomalies.some((item) => item.includes("bot_cannot_approve"))).toBe(true);
    const forged = trace.timeline.find((line) => line.event === "reject");
    expect(forged?.messageValidation?.ok).toBe(false);
    if (forged?.messageValidation && !forged.messageValidation.ok) {
      expect(forged.messageValidation.code).toBe("bot_cannot_approve");
    }
  });

  it("builds a PID-NC trace through the proposal gate", () => {
    const read = readLogDir(fixtureDir);
    const trace = buildTrace(read.requests["REQ-2026-0002"]!, processes);
    expect(trace.pid).toBe("PID-NC");
    expect(trace.currentStage).toBe("estimation");
    expect(trace.gateDecisions.map((item) => item.gate)).toEqual(["proposal"]);
    expect(trace.gateDecisions[0]?.gateOwner).toBe("change-analyst");
    expect(trace.timeline.some((line) => line.event === "transition" && line.stage === "proposal")).toBe(true);
  });

  it("does not throw when the directory is missing", () => {
    expect(readLogDir(path.join(fixtureDir, "missing")).requests).toEqual({});
  });
});
