import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HandoffEngine, type RequestView } from "./engine.js";
import {
  NC_PREFIX_STAGE_IDS,
  SHARED_STAGE_IDS,
  SUB_AGENT_IDS,
  TEAMMATE_IDS,
  assertSharedSpine,
  loadProcessDefinitionsSync,
} from "./processes.js";
import { validateHandoffMessage } from "./schema.js";
import { FileHandoffStore, MemoryHandoffStore } from "./store.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const HUMANS = {
  proposal: { decidedBy: "Jordan Hale", note: "Customer sponsor approves the proposal." },
  "finance-approval": { decidedBy: "Priya Shah", note: "Finance partner approves the envelope." },
  "security-compliance-approval": {
    decidedBy: "Avery Chen",
    note: "Security officer signs. Iteration gate red_team|security.",
  },
  "release-gate": { decidedBy: "Morgan Lee", note: "Release manager go. No auto-merge." },
} as const;

function clock() {
  let t = Date.parse("2026-11-22T09:00:00.000Z");
  return () => {
    t += 1000;
    return new Date(t).toISOString();
  };
}

function engine(plan?: boolean[]) {
  const eng = new HandoffEngine({
    workspaceRoot,
    store: new MemoryHandoffStore(),
    now: clock(),
  });
  if (plan) eng.setBuildPlan(plan);
  return eng;
}

function drive(eng: HandoffEngine, requestId: string): RequestView {
  for (let i = 0; i < 16; i += 1) {
    const step = eng.runUntilWait(requestId);
    if (!step.ok) throw new Error(`${step.code}: ${step.errors.join("; ")}`);
    if (step.request.state.status === "done" || step.request.state.status === "blocked") {
      return step.request;
    }
    const gate = step.request.pendingGate;
    if (!gate) throw new Error(`open on ${step.request.state.currentStage} without a human gate`);
    const human = HUMANS[gate.gate];
    const decided = eng.recordHumanDecision({
      requestId,
      gate: gate.gate,
      decision: "approved",
      decidedBy: human.decidedBy,
      note: human.note,
    });
    if (!decided.ok) throw new Error(`${decided.code}: ${decided.errors.join("; ")}`);
  }
  throw new Error("handoff did not finish");
}

function consulted(view: RequestView, stage: string, from: string, to: string): boolean {
  return view.messages.some(
    (item) =>
      item.message.kind === "consult" &&
      item.message.action === "consult" &&
      item.message.stage === stage &&
      item.message.from === from &&
      item.message.to === to,
  );
}

function baseMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: "consult",
    pid: "PID-ER",
    pidVersion: "1.0.0",
    requestId: "REQ-2026-0001",
    thread: { channel: "#er-intake", threadId: "thr_2026-0001" },
    from: "lead",
    to: "standards",
    stage: "estimation",
    action: "consult",
    summary: "MOCK: consult",
    artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
    memoryKey: "pid.state.REQ-2026-0001",
    humanGate: null,
    ...overrides,
  };
}

describe("PID specs", () => {
  it("loads the SDLC stage sequences, gates, and owners from the process files", () => {
    const defs = loadProcessDefinitionsSync(workspaceRoot);
    expect(defs.map((item) => item.id)).toEqual(["PID-ER", "PID-NC"]);
    const er = defs[0]!;
    const nc = defs[1]!;
    expect(er.version).toBe("1.0.0");
    expect(nc.version).toBe("1.0.0");
    expect(er.entry.channel).toBe("#er-intake");
    expect(nc.entry.channel).toBe("#new-customer");
    expect(er.cadence.kind).toBe("fixed_sprint");
    expect(nc.cadence.kind).toBe("kickoff_first");
    assertSharedSpine(er);
    assertSharedSpine(nc);
    expect(er.stages.map((stage) => stage.id)).toEqual([...SHARED_STAGE_IDS]);
    expect(nc.stages.map((stage) => stage.id)).toEqual([
      "intake",
      ...NC_PREFIX_STAGE_IDS,
      "estimation",
      "finance-approval",
      "security-compliance-approval",
      "build",
      "test-gate",
      "release-gate",
    ]);
    for (const def of defs) {
      expect(def.botsMayAutoApprove).toBe(false);
      expect(def.securityMandatory).toBe(true);
      expect(def.iterationGate).toBe("red_team|security");
      for (const stage of def.stages) expect(stage.autoApprove).toBe(false);
    }
    expect(er.stages.find((stage) => stage.id === "estimation")!.consulting).toEqual(["standards"]);
    expect(nc.stages.find((stage) => stage.id === "estimation")!.consulting).toEqual([
      "builder",
      "security",
      "standards",
    ]);
    expect(er.stages.find((stage) => stage.id === "security-compliance-approval")!.owner).toBe("security");
    expect(nc.stages.find((stage) => stage.id === "proposal")!.humanApprover).toBe("Customer sponsor");
    expect(er.humanGates).toEqual([
      "finance-approval",
      "security-compliance-approval",
      "release-gate",
    ]);
  });
});

describe("handoff happy path", () => {
  it("runs every PID-ER stage across the five teammates and the three mock sub-agents", () => {
    const previous = process.env.RELEASEDESK_CLOUD_CLIENT;
    process.env.RELEASEDESK_CLOUD_CLIENT = "real";
    try {
      const eng = engine();
      const opened = eng.openRequest({
        pid: "PID-ER",
        customerLabel: "NORTHWIND-014",
        summary: "KYC address refresh for an existing customer.",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const view = drive(eng, opened.request.state.requestId);

      expect(view.state.status).toBe("done");
      expect(view.state.pid).toBe("PID-ER");
      expect(view.kickoff).toBeNull();
      expect(view.transitions.map((item) => `${item.fromStage ?? "null"}→${item.toStage}`)).toEqual([
        "null→intake",
        "intake→estimation",
        "estimation→finance-approval",
        "finance-approval→security-compliance-approval",
        "security-compliance-approval→build",
        "build→test-gate",
        "test-gate→release-gate",
      ]);
      expect(view.decisions.map((item) => `${item.gate}:${item.decidedBy}`)).toEqual([
        "finance-approval:Priya Shah",
        "security-compliance-approval:Avery Chen",
        "release-gate:Morgan Lee",
      ]);
      expect(view.stages.every((stage) => stage.reached)).toBe(true);
      expect(consulted(view, "estimation", "change-analyst", "standards")).toBe(true);
      expect(consulted(view, "security-compliance-approval", "security", "standards")).toBe(true);
      expect(consulted(view, "security-compliance-approval", "security", "change-analyst")).toBe(true);
      expect(consulted(view, "build", "builder", "security")).toBe(true);
      expect(consulted(view, "release-gate", "lead", "builder")).toBe(true);
      expect(view.subAgents.map((item) => item.agent)).toEqual(["coding", "testing", "review"]);
      expect(view.subAgents.every((item) => item.cloudClient === "mock" && item.mock)).toBe(true);
      expect(view.lastBuild?.testsPassed).toBe(true);
      expect(view.cloudClient).toBe("mock");

      const seen = new Set<string>();
      for (const item of view.messages) {
        seen.add(item.message.from);
        seen.add(item.message.to);
        expect(item.message.humanGate?.status ?? "pending").not.toBe("approved");
        expect(item.message.humanGate?.status ?? "pending").not.toBe("rejected");
      }
      for (const id of TEAMMATE_IDS) expect(seen.has(id)).toBe(true);
      for (const id of SUB_AGENT_IDS) expect(view.subAgents.some((item) => item.agent === id)).toBe(true);
      expect(view.stateWrites.every((item) => item.actor === "lead")).toBe(true);
      expect(view.posts.some((item) => item.channel === "#release-desk")).toBe(true);
      expect(view.trace.some((item) => item.type === "message" && item.text.includes("build-result"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.RELEASEDESK_CLOUD_CLIENT;
      else process.env.RELEASEDESK_CLOUD_CLIENT = previous;
    }
  });

  it("runs every PID-NC stage, including proposal, kickoff, and the heavy estimate", () => {
    const eng = engine();
    const opened = eng.openRequest({
      pid: "PID-NC",
      customerLabel: "Harbor & Co",
      summary: "New customer asking for a KYC product Northwind does not yet run.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const view = drive(eng, opened.request.state.requestId);

    expect(view.state.status).toBe("done");
    expect(view.state.thread.channel).toBe("#new-customer");
    expect(view.transitions.map((item) => item.toStage)).toEqual([
      "intake",
      "customer-onboarding",
      "discovery",
      "scope",
      "proposal",
      "estimation",
      "finance-approval",
      "security-compliance-approval",
      "build",
      "test-gate",
      "release-gate",
    ]);
    expect(view.kickoff?.namedBy).toBe("lead");
    expect(view.kickoff?.sprint).toBe("future-sprint");
    const buildAt = view.transitions.find((item) => item.toStage === "build")!.at;
    expect(view.kickoff!.at <= buildAt).toBe(true);
    expect(view.decisions.map((item) => item.gate)).toEqual([
      "proposal",
      "finance-approval",
      "security-compliance-approval",
      "release-gate",
    ]);
    expect(consulted(view, "discovery", "change-analyst", "security")).toBe(true);
    expect(consulted(view, "scope", "change-analyst", "standards")).toBe(true);
    expect(consulted(view, "estimation", "change-analyst", "builder")).toBe(true);
    expect(consulted(view, "proposal", "lead", "standards")).toBe(true);
    expect(view.messages.some((item) => item.message.summary.includes("40–60 engineer-days"))).toBe(true);
    expect(view.subAgents.map((item) => item.agent)).toEqual(["coding", "testing", "review"]);
    expect(view.artifacts[`pid.onboarding.${view.state.requestId}`]).toMatchObject({ mock: true });
  });

  it("returns a failed test gate to Builder and accepts the next passing build", () => {
    const eng = engine([false, true]);
    const opened = eng.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Defect fix that fails the first test gate.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const view = drive(eng, opened.request.state.requestId);
    expect(view.state.status).toBe("done");
    expect(view.lastBuild?.testsPassed).toBe(true);
    expect(view.lastBuild?.attempt).toBe(2);
    expect(view.subAgents.filter((item) => item.agent === "coding")).toHaveLength(2);
    expect(
      view.messages.some(
        (item) => item.message.kind === "stage-handoff" && item.message.action === "remediate" && item.message.to === "builder",
      ),
    ).toBe(true);
    expect(view.transitions.map((item) => `${item.fromStage}→${item.toStage}`)).toContain("test-gate→build");
  });

  it("blocks the release when the release manager rejects the gate", () => {
    const eng = engine();
    const opened = eng.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Enhancement that will be rejected at release.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const requestId = opened.request.state.requestId;
    for (let i = 0; i < 8; i += 1) {
      const step = eng.runUntilWait(requestId);
      if (!step.ok) throw new Error(step.errors.join("; "));
      const gate = step.request.pendingGate;
      if (!gate) break;
      const decision = gate.gate === "release-gate" ? "rejected" : "approved";
      const human = HUMANS[gate.gate];
      const decided = eng.recordHumanDecision({
        requestId,
        gate: gate.gate,
        decision,
        decidedBy: human.decidedBy,
        note: decision === "rejected" ? "Release manager no-go." : human.note,
      });
      if (!decided.ok) throw new Error(decided.errors.join("; "));
      if (decision === "rejected") {
        expect(decided.request.state.status).toBe("blocked");
        expect(decided.request.state.currentStage).toBe("release-gate");
        return;
      }
    }
    throw new Error("release gate was not rejected");
  });
});

describe("handoff rejections", () => {
  const processes = loadProcessDefinitionsSync(workspaceRoot);

  it("rejects an invalid schema", () => {
    const result = validateHandoffMessage({ v: 2, kind: "nope" }, processes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_schema");
  });

  it("rejects a non-Lead write of pid.state and leaves the stage unchanged", () => {
    const eng = engine();
    const opened = eng.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "State write attempt.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const requestId = opened.request.state.requestId;
    const before = opened.request.state.currentStage;
    const write = eng.writePidState("security", requestId, { currentStage: "release-gate" });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.code).toBe("only_lead_writes_pid_state");
    const message = eng.submitMessage({
      ...baseMessage({ requestId, memoryKey: `pid.state.${requestId}`, from: "security", to: "lead" }),
      pidState: { currentStage: "release-gate" },
    });
    expect(message.ok).toBe(false);
    if (!message.ok) expect(message.code).toBe("only_lead_writes_pid_state");
    expect(eng.getRequest(requestId)?.state.currentStage).toBe(before);
  });

  it("rejects a bot setting humanGate approved", () => {
    const eng = engine();
    const opened = eng.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Bot approval attempt.",
      requestId: "REQ-2026-0001",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const before = eng.getRequest("REQ-2026-0001")!.messages.length;
    const result = eng.submitMessage(
      baseMessage({
        kind: "stage-return",
        action: "return",
        from: "security",
        to: "lead",
        stage: "security-compliance-approval",
        humanGate: {
          gate: "security-compliance-approval",
          status: "approved",
          decidedBy: "security",
          note: "bot signed",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bot_cannot_approve");
    expect(eng.getRequest("REQ-2026-0001")!.messages).toHaveLength(before);
    const human = eng.recordHumanDecision({
      requestId: "REQ-2026-0001",
      gate: "finance-approval",
      decision: "approved",
      decidedBy: "security",
      note: "bot name",
    });
    expect(human.ok).toBe(false);
    if (!human.ok) expect(human.code).toBe("bot_cannot_approve");
  });

  it("rejects an unknown sender and an unknown recipient", () => {
    const sender = validateHandoffMessage(baseMessage({ from: "finance-partner" }), processes);
    expect(sender.ok).toBe(false);
    if (!sender.ok) expect(sender.code).toBe("unknown_sender");

    const recipient = validateHandoffMessage(baseMessage({ to: "coding" }), processes);
    expect(recipient.ok).toBe(false);
    if (!recipient.ok) expect(recipient.code).toBe("unknown_recipient");

    const returned = validateHandoffMessage(
      baseMessage({
        kind: "stage-return",
        action: "return",
        from: "change-analyst",
        to: "builder",
        stage: "estimation",
      }),
      processes,
    );
    expect(returned.ok).toBe(false);
    if (!returned.ok) expect(returned.code).toBe("return_must_go_to_lead");
  });

  it("refuses to launch Builder without a human security approval", () => {
    const eng = engine();
    const opened = eng.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Skip ahead to build.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    const requestId = opened.request.state.requestId;
    const jumped = eng.writePidState("lead", requestId, { currentStage: "build", status: "open" });
    expect(jumped.ok).toBe(true);
    const ran = eng.runUntilWait(requestId);
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.request.state.status).toBe("blocked");
    expect(ran.request.subAgents).toHaveLength(0);
    expect(ran.request.messages.some((item) => item.message.action === "block" && item.message.from === "builder")).toBe(
      true,
    );
  });
});

describe("handoff file store", () => {
  it("reloads a finished request from disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "handoff-"));
    const file = path.join(dir, "handoff.json");
    const first = new HandoffEngine({
      workspaceRoot,
      store: new FileHandoffStore(file),
      now: clock(),
    });
    const opened = first.openRequest({
      pid: "PID-ER",
      customerLabel: "NORTHWIND-014",
      summary: "Persisted enhancement.",
    });
    if (!opened.ok) throw new Error(opened.errors.join("; "));
    drive(first, opened.request.state.requestId);

    const second = new HandoffEngine({
      workspaceRoot,
      store: new FileHandoffStore(file),
      now: clock(),
    });
    const loaded = second.getRequest(opened.request.state.requestId);
    expect(loaded?.state.status).toBe("done");
    expect(loaded?.subAgents.map((item) => item.agent)).toEqual(["coding", "testing", "review"]);
  });
});
