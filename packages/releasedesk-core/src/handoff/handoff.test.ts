import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NC_PREFIX_STAGE_IDS,
  SHARED_STAGE_IDS,
  assertSharedSpine,
  loadProcessDefinitionsSync,
} from "./processes.js";
import { validateHandoffMessage } from "./schema.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("PID specs", () => {
  it("loads the SDLC stage sequences, gates, and owners from the process files", () => {
    const defs = loadProcessDefinitionsSync(workspaceRoot);
    expect(defs.map((item) => item.id)).toEqual(["PID-ER", "PID-NC"]);
    const er = defs[0]!;
    const nc = defs[1]!;
    expect(er.version).toBe("1.1.0");
    expect(nc.version).toBe("1.1.0");
    expect(er.entry.channel).toBe("lead-chat");
    expect(nc.entry.channel).toBe("lead-chat");
    expect(er.gateRaisedBy).toBe("stage-owner");
    expect(nc.auditLog.bot).toBe("log");
    expect(er.auditLog.dirEnv).toBe("RELEASEDESK_LOG_DIR");
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
    expect(er.stages.find((stage) => stage.id === "finance-approval")!.owner).toBe("change-analyst");
    expect(er.stages.find((stage) => stage.id === "finance-approval")!.consulting).toEqual([]);
    expect(er.stages.find((stage) => stage.id === "release-gate")!.owner).toBe("builder");
    expect(er.stages.find((stage) => stage.id === "release-gate")!.consulting).toEqual(["security", "standards"]);
    expect(er.stages.find((stage) => stage.id === "test-gate")!.owner).toBe("lead");
    expect(er.stages.find((stage) => stage.id === "test-gate")!.humanApprover).toBeNull();
    expect(nc.stages.find((stage) => stage.id === "proposal")!.owner).toBe("change-analyst");
    expect(nc.stages.find((stage) => stage.id === "proposal")!.consulting).toEqual(["standards"]);
    expect(nc.stages.find((stage) => stage.id === "proposal")!.humanApprover).toBe("Customer sponsor");
    expect(er.humanGates).toEqual([
      "finance-approval",
      "security-compliance-approval",
      "release-gate",
    ]);
  });
});

describe("validateHandoffMessage", () => {
  const processes = loadProcessDefinitionsSync(workspaceRoot);

  it("rejects an invalid schema", () => {
    const result = validateHandoffMessage({ v: 2, kind: "nope" }, processes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_schema");
  });

  it("rejects an unknown sender and an unknown recipient", () => {
    const sender = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "finance-partner",
        to: "standards",
        stage: "estimation",
        action: "consult",
        summary: "Consult standards on the estimate.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(sender.ok).toBe(false);
    if (!sender.ok) expect(sender.code).toBe("unknown_sender");

    const recipient = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "lead",
        to: "coding",
        stage: "estimation",
        action: "consult",
        summary: "Consult standards on the estimate.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(recipient.ok).toBe(false);
    if (!recipient.ok) expect(recipient.code).toBe("unknown_recipient");

    const ownerReturn = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "change-analyst",
        to: "lead",
        stage: "finance-approval",
        action: "return",
        summary: "Finance partner approved the sprint envelope.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: {
          gate: "finance-approval",
          status: "approved",
          decidedBy: "Priya Shah",
          note: "2026-11-22T15:40:00+05:30 | verbatim: APPROVE finance-approval REQ-2026-0001 as Finance partner - ok",
        },
      },
      processes,
    );
    expect(ownerReturn.ok).toBe(true);

    const mismatch = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "security",
        to: "lead",
        stage: "finance-approval",
        action: "return",
        summary: "Security tried to record the finance decision.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: {
          gate: "finance-approval",
          status: "approved",
          decidedBy: "Priya Shah",
          note: "2026-11-22T15:40:00+05:30 | verbatim: APPROVE finance-approval",
        },
      },
      processes,
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe("gate_owner_mismatch");

    const botName = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "change-analyst",
        to: "lead",
        stage: "finance-approval",
        action: "return",
        summary: "A bot name cannot decide the finance gate.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: {
          gate: "finance-approval",
          status: "approved",
          decidedBy: "security",
          note: "2026-11-22T15:40:00+05:30 | verbatim: APPROVE",
        },
      },
      processes,
    );
    expect(botName.ok).toBe(false);
    if (!botName.ok) expect(botName.code).toBe("bot_cannot_approve");

    const missingVerbatim = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "change-analyst",
        to: "lead",
        stage: "finance-approval",
        action: "return",
        summary: "The finance note is missing the verbatim reply.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: {
          gate: "finance-approval",
          status: "approved",
          decidedBy: "Priya Shah",
          note: "approved",
        },
      },
      processes,
    );
    expect(missingVerbatim.ok).toBe(false);
    if (!missingVerbatim.ok) expect(missingVerbatim.code).toBe("bot_cannot_approve");

    const leadApproves = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "lead",
        to: "lead",
        stage: "finance-approval",
        action: "return",
        summary: "Lead cannot approve a human gate.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: {
          gate: "finance-approval",
          status: "approved",
          decidedBy: "Priya Shah",
          note: "2026-11-22T15:40:00+05:30 | verbatim: APPROVE",
        },
      },
      processes,
    );
    expect(leadApproves.ok).toBe(false);
    if (!leadApproves.ok) expect(leadApproves.code).toBe("bot_cannot_approve");

    const otherChannel = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "#er-intake", threadId: "thr_2026-0001" },
        from: "lead",
        to: "standards",
        stage: "estimation",
        action: "consult",
        summary: "Chat is the only channel.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(otherChannel.ok).toBe(false);
    if (!otherChannel.ok) expect(otherChannel.code).toBe("invalid_schema");

    const logSender = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "log",
        to: "standards",
        stage: "estimation",
        action: "consult",
        summary: "The log is not a sender.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(logSender.ok).toBe(false);
    if (!logSender.ok) expect(logSender.code).toBe("unknown_sender");

    const logRecipient = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "lead",
        to: "log",
        stage: "estimation",
        action: "consult",
        summary: "The log is not a recipient.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(logRecipient.ok).toBe(false);
    if (!logRecipient.ok) expect(logRecipient.code).toBe("unknown_recipient");

    const returned = validateHandoffMessage(
      {
        v: 1,
        kind: "stage-return",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "change-analyst",
        to: "builder",
        stage: "estimation",
        action: "return",
        summary: "A stage return comes back to Lead.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
      },
      processes,
    );
    expect(returned.ok).toBe(false);
    if (!returned.ok) expect(returned.code).toBe("return_must_go_to_lead");
  });

  it("rejects pidState, writesPidState, and statePatch from a non-lead sender", () => {
    const pidState = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "security",
        to: "lead",
        stage: "security-compliance-approval",
        action: "return",
        summary: "Security tried to write pid.state.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
        pidState: { currentStage: "release-gate" },
      },
      processes,
    );
    expect(pidState.ok).toBe(false);
    if (!pidState.ok) expect(pidState.code).toBe("only_lead_writes_pid_state");

    const writesPidState = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "builder",
        to: "lead",
        stage: "build",
        action: "return",
        summary: "Builder tried to write pid.state.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
        writesPidState: true,
      },
      processes,
    );
    expect(writesPidState.ok).toBe(false);
    if (!writesPidState.ok) expect(writesPidState.code).toBe("only_lead_writes_pid_state");

    const statePatch = validateHandoffMessage(
      {
        v: 1,
        kind: "consult",
        pid: "PID-ER",
        pidVersion: "1.1.0",
        requestId: "REQ-2026-0001",
        thread: { channel: "lead-chat", threadId: "thr_2026-0001" },
        from: "standards",
        to: "lead",
        stage: "estimation",
        action: "return",
        summary: "Standards tried to patch pid.state.",
        artifactRefs: ["memory:pid.artifacts.REQ-2026-0001"],
        memoryKey: "pid.state.REQ-2026-0001",
        humanGate: null,
        statePatch: { currentStage: "release-gate" },
      },
      processes,
    );
    expect(statePatch.ok).toBe(false);
    if (!statePatch.ok) expect(statePatch.code).toBe("only_lead_writes_pid_state");
  });
});
