import { z } from "zod";
import {
  HANDOFF_ACTOR_IDS,
  HUMAN_GATE_IDS,
  isHandoffActor,
  isHumanActor,
  stageOwner,
  type ProcessDefinition,
  type TeammateId,
} from "./process-defs.js";

export const HANDOFF_KINDS = [
  "stage-handoff",
  "consult",
  "stage-return",
  "build-result",
  "public-status",
] as const;
export const HANDOFF_ACTIONS = ["start", "consult", "return", "remediate", "block", "request", "status"] as const;
export const THREAD_CHANNELS = ["lead-chat"] as const;

/** Owner stage-return note: ISO-8601 time, then the human's verbatim reply. */
export const VERBATIM_NOTE = /^\d{4}-\d{2}-\d{2}T[^|]+\| verbatim: .+/;

const STATE_WRITE_KEYS = ["pidState", "writesPidState", "statePatch"] as const;

export const HumanGateSchema = z
  .object({
    gate: z.enum(HUMAN_GATE_IDS),
    status: z.enum(["pending", "approved", "rejected"]),
    decidedBy: z.string().min(1).nullable(),
    note: z.string(),
  })
  .strict();

export const HandoffMessageSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(HANDOFF_KINDS),
    pid: z.enum(["PID-ER", "PID-NC"]),
    pidVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    requestId: z.string().regex(/^REQ-[A-Za-z0-9-]+$/),
    thread: z
      .object({
        channel: z.enum(THREAD_CHANNELS),
        threadId: z.string().min(1),
      })
      .strict(),
    from: z.enum(HANDOFF_ACTOR_IDS),
    to: z.enum(HANDOFF_ACTOR_IDS),
    stage: z.string().min(1),
    action: z.enum(HANDOFF_ACTIONS),
    summary: z.string().min(1),
    artifactRefs: z.array(z.string().min(1)),
    memoryKey: z.string().min(1),
    humanGate: HumanGateSchema.nullable(),
    referenceId: z.string().min(1).optional(),
    proposedBranch: z.string().min(1).optional(),
    prUrl: z.string().min(1).optional(),
    testsPassed: z.boolean().optional(),
    testsSummary: z.string().min(1).optional(),
  })
  .strict();

export type HandoffMessage = z.infer<typeof HandoffMessageSchema>;
export type HumanGateCard = z.infer<typeof HumanGateSchema>;

export type HandoffCode =
  | "invalid_schema"
  | "unknown_sender"
  | "unknown_recipient"
  | "only_lead_writes_pid_state"
  | "bot_cannot_approve"
  | "gate_owner_mismatch"
  | "return_must_go_to_lead"
  | "only_lead_hands_off_stage"
  | "intake_only_to_lead"
  | "unknown_request"
  | "unknown_stage"
  | "not_waiting_for_human"
  | "decided_by_must_be_human"
  | "wrong_gate"
  | "stalled";

export type ValidationResult =
  | { ok: true; message: HandoffMessage }
  | { ok: false; code: HandoffCode; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateHandoffMessage(
  raw: unknown,
  processes: readonly ProcessDefinition[],
): ValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, code: "invalid_schema", errors: ["Message must be an object"] };
  }

  const from = raw.from;
  const stateKeys = STATE_WRITE_KEYS.filter((key) => key in raw);
  if (stateKeys.length > 0) {
    if (typeof from === "string" && from !== "lead") {
      return {
        ok: false,
        code: "only_lead_writes_pid_state",
        errors: [
          `Only Lead writes pid.state. ${from} included ${stateKeys.join(", ")} on a teammate message.`,
        ],
      };
    }
    return {
      ok: false,
      code: "invalid_schema",
      errors: [
        "pid.state is not a field on the handoff message. Lead writes it through the stage record.",
      ],
    };
  }

  if (typeof from === "string" && !isHandoffActor(from)) {
    return {
      ok: false,
      code: "unknown_sender",
      errors: [`Unknown sender "${from}". Handoff actors are ${HANDOFF_ACTOR_IDS.join(", ")}.`],
    };
  }
  if (typeof raw.to === "string" && !isHandoffActor(raw.to)) {
    return {
      ok: false,
      code: "unknown_recipient",
      errors: [`Unknown recipient "${raw.to}". Sub-agents are not handoff recipients.`],
    };
  }

  const parsed = HandoffMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_schema",
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "message"}: ${issue.message}`),
    };
  }

  const message = parsed.data;
  const errors: string[] = [];
  let code: HandoffCode = "invalid_schema";

  const process = processes.find((item) => item.id === message.pid);
  if (!process) {
    errors.push(`Unknown pid ${message.pid}`);
  } else {
    if (message.pidVersion !== process.version) {
      errors.push(`pidVersion ${message.pidVersion} does not match ${process.id} ${process.version}`);
    }
    if (!process.stages.some((stage) => stage.id === message.stage)) {
      errors.push(`Stage "${message.stage}" is not in ${process.id}`);
    }
    if (message.thread.channel !== process.entry.channel) {
      errors.push(`Thread channel must be ${process.entry.channel} for ${process.id}. Chat only.`);
    }
  }

  const expectedKey = `pid.state.${message.requestId}`;
  if (message.memoryKey !== expectedKey) {
    errors.push(`memoryKey must be ${expectedKey}`);
  }

  if (message.humanGate && message.humanGate.status !== "pending") {
    const gate = message.humanGate;
    const owner = stageOwner(process, gate.gate);
    const human = gate.decidedBy !== null && isHumanActor(gate.decidedBy);
    const shapeOk =
      message.kind === "stage-return" &&
      message.action === "return" &&
      message.to === "lead" &&
      gate.gate === message.stage &&
      human &&
      VERBATIM_NOTE.test(gate.note);
    if (message.from === "lead" || !owner) {
      code = "bot_cannot_approve";
      errors.push(
        "A bot never decides a gate. Lead rejects an approved or rejected humanGate that Lead itself sends.",
      );
    } else if (message.from !== owner) {
      code = "gate_owner_mismatch";
      errors.push(`${message.from} does not own ${gate.gate}. The stage owner is ${owner}.`);
    } else if (!shapeOk) {
      code = "bot_cannot_approve";
      errors.push(
        "The stage owner may set approved or rejected only on a stage-return to Lead, for that gate, with a human decidedBy and a note '<ISO-8601 time> | verbatim: <reply>'.",
      );
    }
  }
  if (message.humanGate?.status === "pending" && message.humanGate.decidedBy !== null) {
    errors.push("A pending human gate has decidedBy null. The human reply fills the name.");
  }

  const setCode = (next: HandoffCode) => {
    if (code === "invalid_schema") code = next;
  };

  if (
    (message.kind === "stage-return" || message.kind === "build-result") &&
    message.to !== "lead"
  ) {
    setCode("return_must_go_to_lead");
    errors.push(`${message.kind} comes back to Lead.`);
  }

  if (message.from === "intake" && message.to !== "lead") {
    setCode("intake_only_to_lead");
    errors.push(
      `Intake talks only to Lead. Refusing a message to ${message.to}.`,
    );
  }
  if (message.from === "intake") {
    errors.push("Intake does not send a handoff.v1 message. Public intake is the signed notice.");
  }
  if (message.kind === "public-status") {
    if (message.from !== "lead" || message.to !== "intake") {
      errors.push("public-status is sent by Lead to Intake.");
    }
    if (message.action !== "status") errors.push("public-status action must be status");
    if (!message.referenceId) errors.push("public-status carries referenceId");
  } else if (message.referenceId !== undefined) {
    errors.push("referenceId belongs on public-status");
  }

  if (message.kind === "stage-handoff" && message.from !== "lead") {
    setCode("only_lead_hands_off_stage");
    errors.push("Only Lead messages the next stage owner.");
  }

  if (message.kind === "stage-handoff" && !["start", "remediate", "block"].includes(message.action)) {
    errors.push("stage-handoff action must be start, remediate, or block");
  }
  if (message.kind === "stage-return" && !["return", "block"].includes(message.action)) {
    errors.push("stage-return action must be return or block");
  }
  if (message.kind === "consult" && !["consult", "return"].includes(message.action)) {
    errors.push("consult action must be consult or return");
  }
  if (message.kind === "build-result") {
    if (message.from !== "builder") errors.push("build-result is sent by Builder");
    if (message.action !== "return") errors.push("build-result action must be return");
    if (message.stage !== "build") errors.push("build-result stage must be build");
    if (!message.proposedBranch || !message.prUrl || message.testsPassed === undefined || !message.testsSummary) {
      errors.push("build-result carries proposedBranch, prUrl, testsPassed, and testsSummary");
    }
  } else if (
    message.proposedBranch !== undefined ||
    message.prUrl !== undefined ||
    message.testsPassed !== undefined ||
    message.testsSummary !== undefined
  ) {
    errors.push("proposedBranch, prUrl, testsPassed, and testsSummary belong on build-result only");
  }

  if (message.kind === "stage-handoff" && process) {
    const stage = process.stages.find((item) => item.id === message.stage);
    if (stage && message.action !== "block" && message.to !== stage.owner) {
      errors.push(`stage-handoff for ${stage.id} goes to owner ${stage.owner}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, code, errors };
  }
  return { ok: true, message };
}

export function teammateLabel(id: TeammateId): string {
  switch (id) {
    case "lead":
      return "Release Desk Lead";
    case "change-analyst":
      return "Change Analyst";
    case "standards":
      return "Standards";
    case "security":
      return "Security";
    case "builder":
      return "Builder";
    default:
      return id;
  }
}
