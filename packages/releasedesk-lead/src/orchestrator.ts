import {
  formatMockNote,
  LeadAgentOutputSchema,
  listReadyTasks,
  nowIso,
  type LeadAgentOutput,
  type RunContext,
  type RunContextStore,
  type TaskRecord,
} from "@releasedesk/core";
import {
  isSpecialistRole,
  type AgentRunner,
  type AgentRunnerMap,
  type AgentRunResult,
  type SpecialistRole,
} from "./agent-runner.js";
import {
  createApprovalGate,
  parseApprovalRecord,
  recordApprovalDecision,
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalKind,
  type ApprovalRecord,
} from "./approval.js";
import { createDefaultStubRunners } from "./stub-runners.js";
import { assessReadiness, type ReadinessAssessment } from "./readiness.js";
import {
  createDmSession,
  receiveDmText,
  receiveDmVoiceStub,
  replyAsLead,
  type DmSession,
} from "./dm-interface.js";

type LeadDelegation = {
  taskId: string;
  agentRole: Exclude<SpecialistRole, never>;
  rationale: string;
};

export type ReleaseCheckTrigger = {
  kind: "scheduled" | "on_demand" | "remediation";
  requestedBy?: string;
  notes?: string;
};

export type StartReleaseCheckInput = {
  goal: string;
  target: {
    repository: string;
    baseRef?: string;
    headRef?: string;
    releaseTag?: string;
  };
  trigger?: ReleaseCheckTrigger;
  /** Override default stub runners per role. */
  runners?: AgentRunnerMap;
  metadata?: Record<string, unknown>;
};

export type ReleaseCheckReport = {
  runId: string;
  run: RunContext;
  leadOutput: LeadAgentOutput;
  assessment: ReadinessAssessment;
  delegations: LeadDelegation[];
  approvals: ApprovalRecord;
  dmSession: DmSession;
};

export type LeadOrchestratorOptions = {
  store: RunContextStore;
  /** Defaults to MOCK stub runners for all specialists. */
  runners?: AgentRunnerMap;
  /** Max builder → reverify cycles after the analysis wave (default 1). */
  maxRemediationCycles?: number;
  /** Per-task retry budget (default 2 attempts total). */
  defaultMaxAttempts?: number;
  /** When false, never schedule builder even if findings recommend it (default true). */
  enableRemediation?: boolean;
};

const ANALYSIS_ROLES: SpecialistRole[] = ["change_analyst", "standards", "security"];

const ROLE_TASK_NAME: Record<SpecialistRole, string> = {
  change_analyst: "Change analysis",
  standards: "Standards compliance",
  security: "Security review",
  builder: "Remediation (builder)",
};

export class LeadOrchestrator {
  private readonly store: RunContextStore;
  private readonly runners: Record<SpecialistRole, AgentRunner>;
  private readonly maxRemediationCycles: number;
  private readonly defaultMaxAttempts: number;
  private readonly enableRemediation: boolean;
  private dmSession: DmSession;

  constructor(options: LeadOrchestratorOptions) {
    this.store = options.store;
    this.runners = {
      ...createDefaultStubRunners(),
      ...options.runners,
    };
    this.maxRemediationCycles = options.maxRemediationCycles ?? 1;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 2;
    this.enableRemediation = options.enableRemediation ?? true;
    this.dmSession = createDmSession();
  }

  /** Primary DM text interface. */
  handleDmText(text: string): DmSession {
    this.dmSession = receiveDmText(this.dmSession, text);
    return this.dmSession;
  }

  /** Voice is MOCK-only in M3. */
  handleDmVoice(transcript: string): DmSession {
    this.dmSession = receiveDmVoiceStub(this.dmSession, transcript);
    return this.dmSession;
  }

  getDmSession(): DmSession {
    return this.dmSession;
  }

  async startOnDemandCheck(input: Omit<StartReleaseCheckInput, "trigger"> & {
    trigger?: Omit<ReleaseCheckTrigger, "kind">;
  }): Promise<ReleaseCheckReport> {
    return this.startReleaseCheck({
      ...input,
      trigger: {
        kind: "on_demand",
        ...(input.trigger?.requestedBy !== undefined
          ? { requestedBy: input.trigger.requestedBy }
          : {}),
        ...(input.trigger?.notes !== undefined ? { notes: input.trigger.notes } : {}),
      },
    });
  }

  async startScheduledCheck(input: Omit<StartReleaseCheckInput, "trigger"> & {
    trigger?: Omit<ReleaseCheckTrigger, "kind">;
  }): Promise<ReleaseCheckReport> {
    return this.startReleaseCheck({
      ...input,
      trigger: {
        kind: "scheduled",
        ...(input.trigger?.requestedBy !== undefined
          ? { requestedBy: input.trigger.requestedBy }
          : {}),
        ...(input.trigger?.notes !== undefined ? { notes: input.trigger.notes } : {}),
      },
    });
  }

  /**
   * Full path: create run → delegate specialists → collect results →
   * optional remediation/reverify → human approval gate → readiness report.
   */
  async startReleaseCheck(input: StartReleaseCheckInput): Promise<ReleaseCheckReport> {
    const trigger = input.trigger ?? { kind: "on_demand" as const };
    const runners = {
      ...this.runners,
      ...input.runners,
    };

    this.dmSession = replyAsLead(
      receiveDmText(
        this.dmSession,
        `Start ${trigger.kind} release check for ${input.target.repository}`,
      ),
      `Starting release check: ${input.goal}`,
    );

    const run = await this.store.create({
      goal: input.goal,
      target: input.target,
      metadata: {
        trigger,
        leadAgent: "lead",
        approvals: { gates: [] } satisfies ApprovalRecord,
        ...(input.metadata ?? {}),
      },
    });

    await this.store.appendAudit({
      runId: run.runId,
      action: "agent.invoked",
      message: "Lead Agent starting release check orchestration",
      actor: { kind: "agent", agentRole: "lead" },
      details: { trigger, target: input.target },
    });

    // Wave 1: analysis specialists in parallel (no inter-dependencies).
    const delegations: LeadDelegation[] = [];
    for (const role of ANALYSIS_ROLES) {
      const { task } = await this.store.addTask(run.runId, {
        name: ROLE_TASK_NAME[role],
        agentRole: role,
        status: "ready",
        retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
        input: this.buildSpecialistInput(role, input, undefined),
      });
      delegations.push({
        taskId: task.id,
        agentRole: role,
        rationale: `Parallel analysis wave — ${ROLE_TASK_NAME[role]}`,
      });
    }

    await this.dispatchUntilIdle(run.runId, runners);

    let cycle = 0;
    while (cycle < this.maxRemediationCycles && this.enableRemediation) {
      const current = await this.requireRun(run.runId);
      const assessment = assessReadiness({
        tasks: current.tasks,
        approvals: parseApprovalRecord(current.metadata.approvals),
        considerRemediation: true,
      });

      if (!assessment.remediationRecommended) break;

      cycle += 1;
      const goals = assessment.blockingIssues.length
        ? assessment.blockingIssues
        : ["Address specialist findings before release"];

      const { task: builderTask } = await this.store.addTask(run.runId, {
        name: `${ROLE_TASK_NAME.builder} (cycle ${cycle})`,
        agentRole: "builder",
        status: "ready",
        retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
        input: {
          remediationGoals: goals,
          baseBranch: input.target.baseRef ?? "main",
          relatedFindings: this.collectRelatedFindings(current.tasks),
        },
      });
      delegations.push({
        taskId: builderTask.id,
        agentRole: "builder",
        rationale: `Remediation cycle ${cycle}`,
      });

      await this.dispatchUntilIdle(run.runId, runners);

      // Reverification after remediation — standards + security, parallel.
      const reverifyRoles: SpecialistRole[] = ["standards", "security"];
      for (const role of reverifyRoles) {
        const { task } = await this.store.addTask(run.runId, {
          name: `Reverify ${ROLE_TASK_NAME[role]} (cycle ${cycle})`,
          agentRole: role,
          status: "ready",
          dependsOn: [builderTask.id],
          retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
          input: {
            ...this.buildSpecialistInput(role, input, current),
            reverify: true,
            remediationCycle: cycle,
          },
        });
        delegations.push({
          taskId: task.id,
          agentRole: role,
          rationale: `Reverification after remediation cycle ${cycle}`,
        });
      }

      await this.store.refreshReadyTasks(run.runId);
      await this.dispatchUntilIdle(run.runId, runners);
    }

    // Human approval gates — modeled, never auto-approved.
    await this.requestApproval(run.runId, "release", "Release decision requires human approval");
    await this.requestApproval(run.runId, "merge", "Merge decision requires human approval");

    const finalRun = await this.requireRun(run.runId);
    const approvals = parseApprovalRecord(finalRun.metadata.approvals);
    const assessment = assessReadiness({
      tasks: finalRun.tasks,
      approvals,
      considerRemediation: this.enableRemediation,
    });

    const leadTaskId =
      finalRun.tasks.find((t) => t.agentRole === "lead")?.id ??
      (
        await this.store.addTask(run.runId, {
          name: "Lead consolidation",
          agentRole: "lead",
          status: "ready",
        })
      ).task.id;

    await this.store.startTask(run.runId, leadTaskId);

    const leadOutput = LeadAgentOutputSchema.parse({
      runId: run.runId,
      taskId: leadTaskId,
      agentRole: "lead",
      status: "completed",
      completedAt: nowIso(),
      summary: assessment.summary,
      evidence: [],
      mocksUsed: this.collectMocksUsed(finalRun.tasks),
      readiness: assessment.readiness,
      delegations,
      blockingIssues: assessment.blockingIssues,
      remediationRecommended: assessment.remediationRecommended,
    });

    await this.store.completeTask(run.runId, leadTaskId, leadOutput as unknown as Record<string, unknown>);

    const completed = await this.store.complete(
      run.runId,
      `Lead readiness: ${leadOutput.readiness}. ${assessment.summary}`,
    );

    this.dmSession = replyAsLead(
      this.dmSession,
      `Release check ${run.runId} finished — readiness: ${leadOutput.readiness}`,
    );

    return {
      runId: run.runId,
      run: completed,
      leadOutput,
      assessment,
      delegations,
      approvals,
      dmSession: this.dmSession,
    };
  }

  async requestApproval(
    runId: string,
    kind: ApprovalKind,
    reason: string,
  ): Promise<ApprovalGate> {
    const run = await this.requireRun(runId);
    const record = parseApprovalRecord(run.metadata.approvals);
    const gate = createApprovalGate(kind, reason);
    record.gates.push(gate);
    await this.store.update(runId, {
      metadata: { ...run.metadata, approvals: record },
    });
    await this.store.appendAudit({
      runId,
      action: "human.approval_requested",
      message: `Human approval requested for ${kind}: ${reason}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: { gateId: gate.id, kind },
    });
    return gate;
  }

  async recordHumanApproval(
    runId: string,
    gateId: string,
    decision: Exclude<ApprovalDecision, "pending">,
    opts?: { decidedBy?: string; notes?: string },
  ): Promise<{ run: RunContext; gate: ApprovalGate; assessment: ReadinessAssessment }> {
    const run = await this.requireRun(runId);
    // Terminal runs: still allow recording approval against metadata via a careful path.
    // Store.update refuses terminal runs — so we only support approval while running,
    // OR before complete. For completed runs, callers should approve before complete
    // in interactive flows. Here we support post-hoc by re-opening metadata only if
    // the run is still mutable; otherwise throw a clear error.
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      throw new Error(
        `Run ${runId} is ${run.status}; record approvals before the Lead completes the run, or use recordApprovalOnReport`,
      );
    }

    const record = parseApprovalRecord(run.metadata.approvals);
    const idx = record.gates.findIndex((g) => g.id === gateId);
    if (idx < 0) throw new Error(`Approval gate ${gateId} not found`);
    const existing = record.gates[idx]!;
    const updated = recordApprovalDecision(existing, decision, opts);
    record.gates[idx] = updated;

    await this.store.update(runId, {
      metadata: { ...run.metadata, approvals: record },
    });
    await this.store.appendAudit({
      runId,
      action: "human.approval_recorded",
      message: `Human approval ${decision} for ${updated.kind}`,
      actor: {
        kind: "human",
        ...(opts?.decidedBy !== undefined ? { name: opts.decidedBy } : {}),
      },
      details: { gateId, decision, kind: updated.kind },
    });

    const next = await this.requireRun(runId);
    const assessment = assessReadiness({
      tasks: next.tasks,
      approvals: record,
    });
    return { run: next, gate: updated, assessment };
  }

  /**
   * Apply approval decisions to a finished report (in-memory reassessment).
   * Does not mutate a terminal store run — used by CLI/tests after the check completes.
   */
  applyApprovalsToReport(
    report: ReleaseCheckReport,
    decisions: Array<{
      gateId: string;
      decision: Exclude<ApprovalDecision, "pending">;
      decidedBy?: string;
      notes?: string;
    }>,
  ): ReleaseCheckReport {
    let approvals = { gates: report.approvals.gates.map((g) => ({ ...g })) };
    for (const d of decisions) {
      const idx = approvals.gates.findIndex((g) => g.id === d.gateId);
      if (idx < 0) throw new Error(`Approval gate ${d.gateId} not found`);
      approvals.gates[idx] = recordApprovalDecision(approvals.gates[idx]!, d.decision, {
        ...(d.decidedBy !== undefined ? { decidedBy: d.decidedBy } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
      });
    }
    const assessment = assessReadiness({
      tasks: report.run.tasks,
      approvals,
    });
    const leadOutput = LeadAgentOutputSchema.parse({
      ...report.leadOutput,
      readiness: assessment.readiness,
      blockingIssues: assessment.blockingIssues,
      remediationRecommended: assessment.remediationRecommended,
      summary: assessment.summary,
      completedAt: nowIso(),
    });
    return { ...report, approvals, assessment, leadOutput };
  }

  // --- internals ---

  private async requireRun(runId: string): Promise<RunContext> {
    const run = await this.store.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  }

  private buildSpecialistInput(
    role: SpecialistRole,
    input: StartReleaseCheckInput,
    prior: RunContext | undefined,
  ): Record<string, unknown> {
    const baseRef = input.target.baseRef ?? "main";
    const headRef = input.target.headRef ?? "HEAD";
    const repository = input.target.repository;

    if (role === "change_analyst") {
      return { repository, baseRef, headRef, focusPaths: [] };
    }
    if (role === "standards") {
      const changeTask = prior?.tasks.find(
        (t) => t.agentRole === "change_analyst" && t.status === "completed",
      );
      return {
        repository,
        policyRefs: ["northwind-kyc-baseline"],
        ...(changeTask?.output?.releaseNotesDraft
          ? { changeSummary: String(changeTask.output.releaseNotesDraft) }
          : {}),
      };
    }
    if (role === "security") {
      return { repository, components: [], advisoryHints: [] };
    }
    return { repository, remediationGoals: ["Remediate findings"] };
  }

  private collectRelatedFindings(tasks: readonly TaskRecord[]): Array<{
    sourceAgent: SpecialistRole | "lead";
    summary: string;
    evidenceIds: string[];
  }> {
    return tasks
      .filter((t) => t.agentRole !== "lead" && t.status === "completed")
      .map((t) => ({
        sourceAgent: t.agentRole as SpecialistRole,
        summary: asString(t.output?.summary) ?? t.name,
        evidenceIds: t.evidence.map((e) => e.id),
      }));
  }

  private collectMocksUsed(tasks: readonly TaskRecord[]): Array<{
    mocked: true;
    mockLabel: string;
    note?: string;
  }> {
    const out: Array<{ mocked: true; mockLabel: string; note?: string }> = [];
    for (const task of tasks) {
      const used = task.output?.mocksUsed;
      if (Array.isArray(used)) {
        for (const m of used) {
          if (m && typeof m === "object" && (m as { mocked?: boolean }).mocked === true) {
            out.push(m as { mocked: true; mockLabel: string; note?: string });
          }
        }
      }
      for (const ev of task.evidence) {
        if (ev.mock) out.push(ev.mock);
      }
    }
    return out;
  }

  /**
   * Dispatch all ready/retrying specialist tasks in parallel waves until idle.
   * Store mutations are serialized; specialist runners execute concurrently.
   */
  private async dispatchUntilIdle(
    runId: string,
    runners: Record<SpecialistRole, AgentRunner>,
  ): Promise<void> {
    const maxWaves = 32;
    for (let wave = 0; wave < maxWaves; wave += 1) {
      await this.store.refreshReadyTasks(runId);
      const run = await this.requireRun(runId);
      const candidates = listReadyTasks(run.tasks).filter(
        (t) =>
          isSpecialistRole(t.agentRole) &&
          (t.status === "ready" || t.status === "pending" || t.status === "retrying"),
      );

      // Also pick up retrying tasks that listReadyTasks may not include.
      const retrying = run.tasks.filter(
        (t) => isSpecialistRole(t.agentRole) && t.status === "retrying",
      );
      const byId = new Map<string, TaskRecord>();
      for (const t of [...candidates, ...retrying]) byId.set(t.id, t);
      const toRun = [...byId.values()];

      if (toRun.length === 0) return;

      // Start serially (store is not concurrency-safe), then run agents in parallel.
      const startedTasks: TaskRecord[] = [];
      for (const task of toRun) {
        if (!isSpecialistRole(task.agentRole)) continue;
        const { task: started } = await this.store.startTask(runId, task.id);
        startedTasks.push(started);
      }

      const settled = await Promise.all(
        startedTasks.map(async (started) => {
          const role = started.agentRole;
          if (!isSpecialistRole(role)) {
            return { started, result: null as AgentRunResult | null };
          }
          const snapshot = await this.requireRun(runId);
          const attempt = started.retry?.attempt ?? 0;
          const runner = runners[role];
          let result: AgentRunResult;
          try {
            result = await runner({
              runId,
              taskId: started.id,
              agentRole: role,
              attempt,
              run: snapshot,
              task: started,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result = {
              status: "failed",
              summary: formatMockNote(`Runner threw: ${message}`),
              payload: { agentRole: role },
              failure: {
                code: "runner_exception",
                message,
                retryable: true,
                failedAt: nowIso(),
              },
            };
          }
          return { started, result };
        }),
      );

      // Persist results serially.
      for (const { started, result } of settled) {
        if (!result) continue;
        await this.recordTaskResult(runId, started, result);
      }
    }
  }

  private async recordTaskResult(
    runId: string,
    started: TaskRecord,
    result: AgentRunResult,
  ): Promise<void> {
    if (result.evidence?.length) {
      for (const ev of result.evidence) {
        await this.store.addEvidence(runId, started.id, ev);
      }
    }

    if (result.status === "completed") {
      await this.store.completeTask(runId, started.id, {
        summary: result.summary,
        ...result.payload,
        ...(result.mocksUsed ? { mocksUsed: result.mocksUsed } : {}),
      });
      return;
    }

    const failure = result.failure ?? {
      code: "agent_failed",
      message: result.summary,
      retryable: result.status === "retrying",
      failedAt: nowIso(),
    };

    await this.store.failTask(runId, started.id, failure, {
      retry: result.status === "retrying" || failure.retryable,
    });
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
