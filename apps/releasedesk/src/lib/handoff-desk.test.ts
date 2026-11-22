import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHandoffEngine } from "./handoff-desk";

describe("desk handover service", () => {
  it("runs PID-ER to the finance gate with the mock cloud client", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desk-handoff-"));
    const engine = createHandoffEngine(path.join(dir, "handoff.json"));
    const opened = engine.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Desk service path.",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ran = engine.runUntilWait(opened.request.state.requestId);
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.request.state.status).toBe("ready-for-human");
    expect(ran.request.pendingGate?.gate).toBe("finance-approval");
    expect(ran.request.cloudClient).toBe("mock");
    expect(ran.request.subAgents).toHaveLength(0);
  });
});
