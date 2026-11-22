import { runStageOwner, consultReply, SDLC_ROSTER } from "./bots.js";
import {
  isHumanActor,
  loadProcessDefinitionsSync,
  processById,
  type HumanGateId,
  type ProcessDefinition,
  type ProcessId,
  type ProcessStage,
  type TeammateId,
} from "./processes.js";
import {
  validateHandoffMessage,
  type HandoffCode,
  type HandoffMessage,
  type ValidationResult,
} from "./schema.js";
import type { DraftInput } from "./bots.js";
import {
  emptySnapshot,
  type HandoffSnapshot,
  type HandoffStore,
  type HumanDecision,
  type PendingGate,
  type RequestRecord,
  type TraceEvent,
} from "./store.js";

export type HandoffFailure = { ok: false; code: HandoffCode; errors: string[] };

export type RequestView = {
  state: RequestRecord["state"];
  stages: Array<{
    id: string;
    name: string;
    owner: TeammateId;
    consulting: TeammateId[];
    humanApprover: string | null;
    current: boolean;
    reached: boolean;
  }>;
  messages: RequestRecord["messages"];
  transitions: RequestRecord["transitions"];
  posts: RequestRecord["posts"];
  decisions: HumanDecision[];
  subAgents: RequestRecord["subAgents"];
  rejections: RequestRecord["rejections"];
  stateWrites: RequestRecord["stateWrites"];
  pendingGate: PendingGate | null;
  lastBuild: RequestRecord["lastBuild"];
  kickoff: RequestRecord["kickoff"];
  artifacts: RequestRecord["artifacts"];
  trace: TraceEvent[];
  mock: true;
  cloudClient: "mock";
};

export type HandoffSuccess = { ok: true; request: RequestView };
export type HandoffResult = HandoffSuccess | HandoffFailure;

export type OpenRequestInput = {
  pid: ProcessId;
  summary: string;
  customerLabel: string;
  requestId?: string;
};

const HUMAN_STAGE_NOTE: Record<string, string> = {
  proposal: "Customer sponsor approves the proposal in the request thread. A bot must not mark it approved.",
  "finance-approval": "Finance partner decides the envelope. No bot may record this decision.",
  "security-compliance-approval":
    "Security officer or AI red-team lead signs. Iteration gate stays red_team|security.",
  "release-gate": "Release manager records go or no-go. Auto-merge stays off.",
};

export class HandoffEngine {
  private snapshot: HandoffSnapshot;
  private readonly processes: ProcessDefinition[];
  private buildPlan: boolean[] = [true];

  constructor(
    private readonly options: {
      workspaceRoot: string;
      store: HandoffStore;
      now?: () => string;
    },
  ) {
    this.snapshot = options.store.load() ?? emptySnapshot();
    this.processes = loadProcessDefinitionsSync(options.workspaceRoot);
    if (this.processes.length === 0) {
      throw new Error("No PID process specs found under grok-bots/processes");
    }
  }

  listProcesses(): ProcessDefinition[] {
    return this.processes;
  }

  roster() {
    return SDLC_ROSTER;
  }

  setBuildPlan(plan: boolean[]): void {
    if (plan.length === 0) throw new Error("build plan must include at least one result");
    this.buildPlan = [...plan];
  }

  listRequests(): RequestView[] {
    return this.snapshot.requests.map((record) => this.view(record));
  }

  getRequest(requestId: string): RequestView | undefined {
    const record = this.snapshot.requests.find((item) => item.state.requestId === requestId);
    return record ? this.view(record) : undefined;
  }

  openRequest(input: OpenRequestInput): HandoffResult {
    const summary = input.summary.trim();
    const customerLabel = input.customerLabel.trim();
    if (!summary || !customerLabel) {
      return { ok: false, code: "invalid_schema", errors: ["summary and customerLabel are required"] };
    }
    const process = processById(this.processes, input.pid);
    const requestId = input.requestId ?? this.mintRequestId();
    if (this.snapshot.requests.some((item) => item.state.requestId === requestId)) {
      return { ok: false, code: "invalid_schema", errors: [`requestId ${requestId} already exists`] };
    }
    const at = this.now();
    const record: RequestRecord = {
      seq: 0,
      state: {
        requestId,
        pid: process.id,
        version: process.version,
        currentStage: "intake",
        status: "open",
        thread: {
          channel: process.entry.channel,
          threadId: `thr_${requestId.slice(4)}`,
        },
        customerLabel,
        summary,
        openedAt: at,
        updatedAt: at,
      },
      messages: [],
      transitions: [],
      posts: [],
      decisions: [],
      subAgents: [],
      rejections: [],
      stateWrites: [],
      artifacts: {},
      pendingGate: null,
      lastBuild: null,
      buildAttempts: 0,
      remediate: false,
      kickoff: null,
    };
    this.snapshot.requests.push(record);
    record.artifacts[`pid.customer.${requestId}`] = {
      label: customerLabel,
      summary,
      customerKind: process.customerKind,
      mock: true,
    };
    this.appendTransition(record, null, "intake", "Lead opened one thread and wrote pid.state.", null);
    this.post(
      record,
      process.entry.channel,
      "lead",
      `MOCK: ${requestId} opened for ${customerLabel}. ${summary}`,
    );
    this.save();
    return { ok: true, request: this.view(record) };
  }

  /**
   * Drive the open stage until a human gate, a block, or done.
   * Mock bots answer inside this call. No live cloud client is used.
   */
  runUntilWait(requestId: string): HandoffResult {
    const record = this.find(requestId);
    if (!record) return this.unknown(requestId);
    for (let step = 0; step < 24; step += 1) {
      if (record.state.status !== "open") {
        this.save();
        return { ok: true, request: this.view(record) };
      }
      const before = `${record.state.currentStage}:${record.transitions.length}:${record.messages.length}`;
      this.dispatchStage(record);
      const after = `${record.state.currentStage}:${record.transitions.length}:${record.messages.length}`;
      if (record.state.status !== "open") {
        this.save();
        return { ok: true, request: this.view(record) };
      }
      if (before === after) {
        this.save();
        return { ok: false, code: "stalled", errors: [`Handoff stalled on ${record.state.currentStage}`] };
      }
    }
    this.save();
    return { ok: false, code: "stalled", errors: ["Handoff exceeded the stage step limit"] };
  }

  submitMessage(raw: unknown): HandoffResult {
    const validated = validateHandoffMessage(raw, this.processes);
    if (!validated.ok) {
      const requestId = this.peekRequestId(raw);
      return this.fail(validated.code, validated.errors, requestId, raw);
    }
    const record = this.find(validated.message.requestId);
    if (!record) return this.fail("unknown_request", [`No request ${validated.message.requestId}`], validated.message.requestId, raw);
    this.accept(record, validated.message);
    this.save();
    return { ok: true, request: this.view(record) };
  }

  writePidState(actor: string, requestId: string, patch: Record<string, unknown>): HandoffResult {
    const record = this.find(requestId);
    if (actor !== "lead") {
      return this.fail(
        "only_lead_writes_pid_state",
        [`Only Lead writes pid.state.${requestId}. ${actor} was refused.`],
        requestId,
        { actor, patch },
      );
    }
    if (!record) return this.unknown(requestId);
    const fields: string[] = [];
    if (typeof patch.currentStage === "string") {
      const process = processById(this.processes, record.state.pid);
      if (!process.stages.some((stage) => stage.id === patch.currentStage)) {
        return this.fail("unknown_stage", [`${String(patch.currentStage)} is not a ${process.id} stage`], requestId, patch);
      }
      record.state.currentStage = patch.currentStage;
      fields.push("currentStage");
    }
    if (patch.status === "open" || patch.status === "blocked" || patch.status === "ready-for-human" || patch.status === "done") {
      record.state.status = patch.status;
      fields.push("status");
    }
    if (fields.length === 0) {
      return this.fail("invalid_schema", ["Lead patch needs currentStage or status"], requestId, patch);
    }
    record.state.updatedAt = this.now();
    record.stateWrites.push({
      seq: this.nextSeq(record),
      at: record.state.updatedAt,
      actor: "lead",
      requestId,
      fields,
    });
    this.save();
    return { ok: true, request: this.view(record) };
  }

  recordHumanDecision(input: {
    requestId: string;
    gate: HumanGateId;
    decision: "approved" | "rejected";
    decidedBy: string;
    note?: string;
  }): HandoffResult {
    const decidedBy = input.decidedBy.trim();
    if (!isHumanActor(decidedBy)) {
      return this.fail(
        "bot_cannot_approve",
        [`${input.decidedBy || "empty"} is a bot id. A human name must decide ${input.gate}.`],
        input.requestId,
        input,
      );
    }
    const record = this.find(input.requestId);
    if (!record) return this.unknown(input.requestId);
    if (record.state.status !== "ready-for-human" || !record.pendingGate) {
      return this.fail("not_waiting_for_human", ["This request is not waiting on a human gate"], input.requestId, input);
    }
    if (record.pendingGate.gate !== input.gate) {
      return this.fail(
        "wrong_gate",
        [`Open gate is ${record.pendingGate.gate}, not ${input.gate}`],
        input.requestId,
        input,
      );
    }
    const at = this.now();
    const note = input.note?.trim() || record.pendingGate.note;
    const decision: HumanDecision = {
      seq: this.nextSeq(record),
      at,
      gate: input.gate,
      decision: input.decision,
      decidedBy,
      note,
    };
    record.decisions.push(decision);
    record.artifacts[`pid.decisions.${record.state.requestId}`] = record.decisions.map((item) => ({
      gate: item.gate,
      decision: item.decision,
      decidedBy: item.decidedBy,
      at: item.at,
      note: item.note,
    }));
    record.pendingGate = null;
    this.post(
      record,
      record.state.thread.channel,
      decidedBy,
      `${decidedBy} ${input.decision} ${input.gate}. ${note}`,
    );
    this.post(
      record,
      "#release-desk",
      "lead",
      `Mirrored human reply on ${record.state.requestId}: ${decidedBy} ${input.decision} ${input.gate}.`,
    );

    if (input.decision === "rejected") {
      this.commitState(record, { status: "blocked" }, ["status"]);
      this.save();
      return { ok: true, request: this.view(record) };
    }

    const process = processById(this.processes, record.state.pid);
    const isLast = process.stages[process.stages.length - 1]?.id === record.state.currentStage;
    if (isLast) {
      this.commitState(record, { status: "done" }, ["status"]);
      this.post(record, record.state.thread.channel, "lead", `MOCK: ${record.state.requestId} is done. Nothing was auto-merged.`);
      this.save();
      return { ok: true, request: this.view(record) };
    }

    this.enterNext(record, `${decidedBy} approved ${input.gate}.`, {
      gate: input.gate,
      decision: "approved",
      decidedBy,
      at,
    });
    this.save();
    return { ok: true, request: this.view(record) };
  }

  private dispatchStage(record: RequestRecord): void {
    const stage = this.stageOf(record);
    if (stage.owner === "lead") {
      this.runLeadStage(record, stage);
      return;
    }
    const action = record.remediate ? "remediate" : "start";
    record.remediate = false;
    const handoff = this.draft(record, {
      from: "lead",
      to: stage.owner,
      kind: "stage-handoff",
      action,
      stage: stage.id,
      summary: `MOCK: Lead hands ${stage.name} to ${stage.owner} (${action}). ${record.state.summary}`,
      humanGate: null,
    });
    this.accept(record, handoff);
    const produced = runStageOwner(stage.owner, {
      inbound: handoff,
      record,
      stage,
      now: this.now(),
      nextTestsPassed: () => this.takeBuildResult(record),
      draft: (input) => this.draft(record, input),
      noteSubAgent: (event) => {
        record.subAgents.push({
          seq: this.nextSeq(record),
          at: this.now(),
          parent: "builder",
          requestId: record.state.requestId,
          mock: true,
          cloudClient: "mock",
          agent: event.agent,
          summary: event.summary,
          parallelGroup: event.parallelGroup,
        });
      },
    });
    for (const message of produced) this.accept(record, message);
  }

  private runLeadStage(record: RequestRecord, stage: ProcessStage): void {
    if (stage.id === "test-gate") {
      this.runTestGate(record, stage);
      return;
    }
    this.consultAs(record, "lead", stage);
    if (stage.id === "customer-onboarding") {
      record.artifacts[`pid.onboarding.${record.state.requestId}`] = {
        mock: true,
        dossier: "MOCK: Sponsor, jurisdiction, and data-processing addendum recorded. This stage does not approve the proposal.",
      };
    }
    if (stage.humanApprover) {
      this.postHumanGate(record, stage);
      return;
    }
    this.enterNext(record, `Lead finished ${stage.name}.`, null);
  }

  private runTestGate(record: RequestRecord, stage: ProcessStage): void {
    if (!record.lastBuild) {
      this.commitState(record, { status: "blocked" }, ["status"]);
      this.post(record, record.state.thread.channel, "lead", "Test gate has no build-result. Lead will not waive it.");
      return;
    }
    this.consultAs(record, "lead", stage);
    if (!record.lastBuild.testsPassed) {
      record.remediate = true;
      this.enterStage(record, "build", "Tests failed. Lead returns the request to Builder and does not waive a security finding.", null);
      return;
    }
    this.enterNext(record, `Test gate passed. ${record.lastBuild.testsSummary}`, null);
  }

  private consultAs(record: RequestRecord, from: TeammateId, stage: ProcessStage): void {
    for (const to of stage.consulting) {
      const ask = this.draft(record, {
        from,
        to,
        kind: "consult",
        action: "consult",
        stage: stage.id,
        summary: `MOCK: ${from} asks ${to} to consult on ${stage.name}.`,
        humanGate: null,
      });
      this.accept(record, ask);
      this.accept(record, consultReply(to, ask, (input) => this.draft(record, input)));
    }
  }

  private postHumanGate(record: RequestRecord, stage: ProcessStage): void {
    const gate = stage.id as HumanGateId;
    const note = HUMAN_STAGE_NOTE[gate] ?? `Waiting for ${stage.humanApprover}.`;
    record.pendingGate = {
      gate,
      status: "pending",
      decidedBy: null,
      note,
      approver: stage.humanApprover ?? "human",
    };
    this.commitState(record, { status: "ready-for-human" }, ["status"]);
    this.post(
      record,
      record.state.thread.channel,
      "lead",
      `Human gate ${gate} is pending for ${stage.humanApprover}. ${note}`,
    );
    this.post(
      record,
      "#release-desk",
      "lead",
      `Mirrored gate card ${record.state.requestId} ${gate} pending. Approver: ${stage.humanApprover}.`,
    );
  }

  private enterNext(
    record: RequestRecord,
    reason: string,
    humanDecision: StageHuman | null,
  ): void {
    const process = processById(this.processes, record.state.pid);
    const index = process.stages.findIndex((stage) => stage.id === record.state.currentStage);
    const next = process.stages[index + 1];
    if (!next) throw new Error(`No stage after ${record.state.currentStage}`);
    this.enterStage(record, next.id, reason, humanDecision);
  }

  private enterStage(
    record: RequestRecord,
    toStage: string,
    reason: string,
    humanDecision: StageHuman | null,
  ): void {
    if (toStage === "build" && record.state.pid === "PID-NC" && !record.kickoff) {
      const at = this.now();
      record.kickoff = {
        sprint: "future-sprint",
        at,
        namedBy: "lead",
        note: "Kickoff names a future sprint. Build has not started. This is not a PID stage id.",
      };
      record.artifacts[`pid.kickoff.${record.state.requestId}`] = record.kickoff;
      this.post(
        record,
        record.state.thread.channel,
        "lead",
        `Kickoff record names ${record.kickoff.sprint}. Builder starts only after this record.`,
      );
    }
    this.appendTransition(record, record.state.currentStage, toStage, reason, humanDecision);
  }

  private accept(record: RequestRecord, message: HandoffMessage): void {
    const validated = validateHandoffMessage(message, this.processes);
    if (!validated.ok) {
      throw new Error(`Engine drafted an invalid handoff (${validated.code}): ${validated.errors.join("; ")}`);
    }
    record.messages.push({ seq: this.nextSeq(record), at: this.now(), message: validated.message });
    this.post(
      record,
      record.state.thread.channel,
      validated.message.from,
      `${validated.message.kind} ${validated.message.from} → ${validated.message.to} · ${validated.message.stage}: ${validated.message.summary}`,
    );
    if (validated.message.kind === "build-result" && validated.message.testsPassed !== undefined && validated.message.testsSummary && validated.message.proposedBranch && validated.message.prUrl) {
      record.lastBuild = {
        proposedBranch: validated.message.proposedBranch,
        prUrl: validated.message.prUrl,
        testsPassed: validated.message.testsPassed,
        testsSummary: validated.message.testsSummary,
        attempt: record.buildAttempts,
      };
      record.artifacts[`pid.build.${record.state.requestId}`] = record.lastBuild;
      this.enterNext(record, "Builder returned the pull request and the test result.", null);
      return;
    }
    if (validated.message.kind === "stage-return") {
      record.artifacts[`pid.slice.${validated.message.from}.${validated.message.stage}`] = validated.message.summary;
      if (validated.message.action === "block") {
        this.commitState(record, { status: "blocked" }, ["status"]);
        this.post(record, record.state.thread.channel, "lead", validated.message.summary);
        return;
      }
      const stage = this.stageOf(record);
      if (stage.humanApprover) {
        this.postHumanGate(record, stage);
        return;
      }
      this.enterNext(record, validated.message.summary, null);
    }
  }

  private appendTransition(
    record: RequestRecord,
    fromStage: string | null,
    toStage: string,
    reason: string,
    humanDecision: StageHuman | null,
  ): void {
    const at = this.now();
    record.transitions.push({
      seq: this.nextSeq(record),
      requestId: record.state.requestId,
      pid: record.state.pid,
      pidVersion: record.state.version,
      fromStage,
      toStage,
      at,
      actor: "lead",
      reason,
      humanDecision,
    });
    this.commitState(record, { currentStage: toStage, status: "open" }, ["currentStage", "status"]);
    this.post(record, record.state.thread.channel, "lead", `${fromStage ?? "opened"} → ${toStage}. ${reason}`);
  }

  private commitState(
    record: RequestRecord,
    patch: Partial<Pick<RequestRecord["state"], "currentStage" | "status">>,
    fields: string[],
  ): void {
    if (patch.currentStage) record.state.currentStage = patch.currentStage;
    if (patch.status) record.state.status = patch.status;
    record.state.updatedAt = this.now();
    record.stateWrites.push({
      seq: this.nextSeq(record),
      at: record.state.updatedAt,
      actor: "lead",
      requestId: record.state.requestId,
      fields,
    });
  }

  private draft(record: RequestRecord, input: DraftInput): HandoffMessage {
    const message: HandoffMessage = {
      v: 1,
      kind: input.kind,
      pid: record.state.pid,
      pidVersion: record.state.version,
      requestId: record.state.requestId,
      thread: { ...record.state.thread },
      from: input.from,
      to: input.to,
      stage: input.stage,
      action: input.action,
      summary: input.summary,
      artifactRefs: input.artifactRefs ?? [`memory:pid.artifacts.${record.state.requestId}`],
      memoryKey: `pid.state.${record.state.requestId}`,
      humanGate: input.humanGate,
    };
    if (input.proposedBranch) message.proposedBranch = input.proposedBranch;
    if (input.prUrl) message.prUrl = input.prUrl;
    if (input.testsPassed !== undefined) message.testsPassed = input.testsPassed;
    if (input.testsSummary) message.testsSummary = input.testsSummary;
    return message;
  }

  private takeBuildResult(record: RequestRecord): boolean {
    const index = Math.min(record.buildAttempts, this.buildPlan.length - 1);
    return this.buildPlan[index] ?? true;
  }

  private stageOf(record: RequestRecord): ProcessStage {
    const process = processById(this.processes, record.state.pid);
    const stage = process.stages.find((item) => item.id === record.state.currentStage);
    if (!stage) throw new Error(`Stage ${record.state.currentStage} missing from ${process.id}`);
    return stage;
  }

  private post(record: RequestRecord, channel: string, author: string, text: string): void {
    record.posts.push({
      seq: this.nextSeq(record),
      at: this.now(),
      channel,
      author,
      text,
    });
  }

  private nextSeq(record: RequestRecord): number {
    record.seq += 1;
    return record.seq;
  }

  private mintRequestId(): string {
    const id = `REQ-2026-${String(this.snapshot.nextSeq).padStart(4, "0")}`;
    this.snapshot.nextSeq += 1;
    return id;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private find(requestId: string): RequestRecord | undefined {
    return this.snapshot.requests.find((item) => item.state.requestId === requestId);
  }

  private save(): void {
    this.options.store.save(this.snapshot);
  }

  private unknown(requestId: string): HandoffFailure {
    return this.fail("unknown_request", [`No request ${requestId}`], requestId, { requestId });
  }

  private fail(code: HandoffCode, errors: string[], requestId: string | undefined, raw: unknown): HandoffFailure {
    const at = this.now();
    const rejection = { seq: 0, at, code, errors, ...(requestId ? { requestId } : {}) };
    this.snapshot.rejections.push(rejection);
    const record = requestId ? this.find(requestId) : undefined;
    if (record) {
      record.rejections.push({ ...rejection, seq: this.nextSeq(record) });
    }
    this.save();
    return { ok: false, code, errors };
  }

  private peekRequestId(raw: unknown): string | undefined {
    if (typeof raw === "object" && raw !== null && "requestId" in raw) {
      const value = (raw as { requestId?: unknown }).requestId;
      return typeof value === "string" ? value : undefined;
    }
    return undefined;
  }

  private view(record: RequestRecord): RequestView {
    const process = processById(this.processes, record.state.pid);
    const reached = new Set(record.transitions.map((item) => item.toStage));
    return {
      state: record.state,
      stages: process.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        owner: stage.owner,
        consulting: [...stage.consulting],
        humanApprover: stage.humanApprover,
        current: stage.id === record.state.currentStage,
        reached: reached.has(stage.id),
      })),
      messages: record.messages,
      transitions: record.transitions,
      posts: record.posts,
      decisions: record.decisions,
      subAgents: record.subAgents,
      rejections: record.rejections,
      stateWrites: record.stateWrites,
      pendingGate: record.pendingGate,
      lastBuild: record.lastBuild,
      kickoff: record.kickoff,
      artifacts: record.artifacts,
      trace: traceOf(record),
      mock: true,
      cloudClient: "mock",
    };
  }
}

type StageHuman = NonNullable<RequestRecord["transitions"][number]["humanDecision"]>;

export function traceOf(record: RequestRecord): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const item of record.transitions) {
    events.push({
      seq: item.seq,
      at: item.at,
      type: "transition",
      stage: item.toStage,
      text: `${item.fromStage ?? "∅"} → ${item.toStage}. ${item.reason}`,
    });
  }
  for (const item of record.messages) {
    events.push({
      seq: item.seq,
      at: item.at,
      type: "message",
      from: item.message.from,
      to: item.message.to,
      kind: item.message.kind,
      stage: item.message.stage,
      text: `${item.message.kind} ${item.message.from} → ${item.message.to}: ${item.message.summary}`,
    });
  }
  for (const item of record.subAgents) {
    events.push({
      seq: item.seq,
      at: item.at,
      type: "subagent",
      from: item.parent,
      to: item.agent,
      text: `${item.agent}: ${item.summary}`,
    });
  }
  for (const item of record.decisions) {
    events.push({
      seq: item.seq,
      at: item.at,
      type: "human",
      text: `${item.decidedBy} ${item.decision} ${item.gate}. ${item.note}`,
    });
  }
  if (record.kickoff) {
    events.push({
      seq: record.transitions.find((item) => item.toStage === "build")?.seq ?? record.seq,
      at: record.kickoff.at,
      type: "kickoff",
      text: `Kickoff names ${record.kickoff.sprint}. ${record.kickoff.note}`,
    });
  }
  for (const item of record.rejections) {
    events.push({
      seq: item.seq,
      at: item.at,
      type: "rejection",
      text: `${item.code}: ${item.errors.join(" ")}`,
    });
  }
  return events.sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at));
}

export function assertValidation(result: ValidationResult): HandoffMessage {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.errors.join("; ")}`);
  }
  return result.message;
}
