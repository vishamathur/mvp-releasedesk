import {
  AI_RED_TEAMING_ROLE,
  AI_RED_TEAMING_TASK_KIND,
  assertMandatoryAnalysisRoles,
  evaluateAiRedTeamingHardBlock,
  evaluateSecurityParticipation,
  formatMockNote,
  LeadAgentOutputSchema,
  listReadyTasks,
  MANDATORY_ANALYSIS_ROLES,
  MANDATORY_SECURITY_ROLE,
  nowIso,
  parseAiRedTeamingFlagRecord,
  SECURITY_TASK_KIND,
  type AiRedTeamingLeadFlag,
  type AiRedTeamingPassKind,
  type AiRedTeamingTouchpoint,
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
import {
  createChecklistsForFeatures,
  detectNewFeaturesFromTasks,
  mergeFeatureSignOffRecords,
  parseFeatureSignOffRecord,
  signOffChecklistItem,
  signOffEntireChecklist,
  type FeatureSignOffChecklist,
  type FeatureSignOffItemId,
  type FeatureSignOffRecord,
} from "./feature-signoff.js";
import { createDefaultStubRunners } from "./stub-runners.js";
import { assessReadiness, type ReadinessAssessment } from "./readiness.js";
import {
  createDmSession,
  receiveDmText,
  receiveDmVoiceStub,
  replyAsLead,
  type DmSession,
} from "./dm-interface.js";
import {
  checkpointNeedsRemediation,
  evaluateCheckpoint,
  parseCheckpointRecord,
  type CheckpointRecord,
  type CheckpointResult,
  type CheckpointStage,
} from "./verification.js";
import {
  describePrClientMode,
  openAndTrackPullRequest,
  parsePullRequestRecord,
  pollTrackedPullRequest,
  resolvePrClient,
  trackExistingPullRequest,
  type PrWorkflowClient,
  type PullRequestRecord,
  type ResolvePrClientOptions,
  type TrackedPullRequest,
} from "./pr/index.js";

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
  /** Per-feature developer checklist sign-offs for AI-produced code. */
  featureSignOffs: FeatureSignOffRecord;
  checkpoints: CheckpointRecord;
  pullRequests: PullRequestRecord;
  dmSession: DmSession;
};

export type LeadOrchestratorOptions = {
  store: RunContextStore;
  /** Defaults to MOCK stub runners for all specialists. */
  runners?: AgentRunnerMap;
  /** Max builder → reverify cycles after the analysis wave (default 2 for M6 loops). */
  maxRemediationCycles?: number;
  /** Per-task retry budget (default 2 attempts total). */
  defaultMaxAttempts?: number;
  /** When false, never schedule builder even if findings recommend it (default true). */
  enableRemediation?: boolean;
  /** PR workflow client options (MOCK when no GH token). */
  prClient?: ResolvePrClientOptions;
  /** When false, skip opening/tracking PRs (default true). */
  enablePrWorkflow?: boolean;
};

/**
 * Analysis wave for every change / release check.
 * Sourced from core `MANDATORY_ANALYSIS_ROLES` — Security is never optional.
 */
const ANALYSIS_ROLES: SpecialistRole[] = [...MANDATORY_ANALYSIS_ROLES];
assertMandatoryAnalysisRoles(ANALYSIS_ROLES);

const ROLE_TASK_NAME: Record<SpecialistRole, string> = {
  change_analyst: "Change analysis",
  standards: "Standards compliance",
  security: "Security review",
  builder: "Remediation (builder)",
  ai_red_teaming: "AI Red Teaming",
};

/** Specialists / Cloud stages that produce AI model/prompt output → guardrail. */
const AI_OUTPUT_TOUCHPOINTS: AiRedTeamingTouchpoint[] = [
  "change_analyst",
  "standards",
  "security",
  "builder",
  "cloud_coding",
  "cloud_testing",
  "cloud_review",
];

export class LeadOrchestrator {
  private readonly store: RunContextStore;
  private readonly runners: Record<SpecialistRole, AgentRunner>;
  private readonly maxRemediationCycles: number;
  private readonly defaultMaxAttempts: number;
  private readonly enableRemediation: boolean;
  private readonly enablePrWorkflow: boolean;
  private readonly prClient: PrWorkflowClient;
  private dmSession: DmSession;

  constructor(options: LeadOrchestratorOptions) {
    this.store = options.store;
    this.runners = {
      ...createDefaultStubRunners(),
      ...options.runners,
    };
    this.maxRemediationCycles = options.maxRemediationCycles ?? 2;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 2;
    this.enableRemediation = options.enableRemediation ?? true;
    this.enablePrWorkflow = options.enablePrWorkflow ?? true;
    this.prClient = resolvePrClient(options.prClient);
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

  getPrClient(): PrWorkflowClient {
    return this.prClient;
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
   * Full path: create run → delegate specialists → checkpoint verify →
   * remediation/reverify loops → PR track/poll → feature checklist sign-offs →
   * human merge/release gates → readiness.
   * Never auto-merges. Never auto-signs feature checklists.
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
        featureSignOffs: { checklists: [] } satisfies FeatureSignOffRecord,
        checkpoints: { checkpoints: [] } satisfies CheckpointRecord,
        pullRequests: { pullRequests: [] } satisfies PullRequestRecord,
        aiRedTeamingFlags: { flags: [] },
        prClientMode: this.prClient.mode,
        prClientDescription: describePrClientMode(this.prClient),
        autoMerge: false,
        ...(input.metadata ?? {}),
      },
    });

    await this.store.appendAudit({
      runId: run.runId,
      action: "agent.invoked",
      message: "Lead Agent starting release check orchestration",
      actor: { kind: "agent", agentRole: "lead" },
      details: {
        trigger,
        target: input.target,
        prClientMode: this.prClient.mode,
      },
    });

    if (this.prClient.mode === "mock") {
      await this.store.appendAudit({
        runId: run.runId,
        action: "mock.integration_used",
        message: describePrClientMode(this.prClient),
        actor: { kind: "system" },
        details: { integration: "github-pr", mode: "mock" },
      });
    }

    // Wave 1: mandatory analysis specialists in parallel (Security always included).
    const delegations: LeadDelegation[] = [];
    for (const role of ANALYSIS_ROLES) {
      const { task } = await this.store.addTask(run.runId, {
        name: ROLE_TASK_NAME[role],
        agentRole: role,
        status: "ready",
        retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
        input: {
          ...this.buildSpecialistInput(role, input, undefined),
          ...(role === MANDATORY_SECURITY_ROLE
            ? { taskKind: SECURITY_TASK_KIND, mandatory: true }
            : {}),
        },
      });
      delegations.push({
        taskId: task.id,
        agentRole: role,
        rationale:
          role === MANDATORY_SECURITY_ROLE
            ? `Mandatory Security participation — ${ROLE_TASK_NAME[role]} (no skip)`
            : `Parallel analysis wave — ${ROLE_TASK_NAME[role]}`,
      });
    }

    await this.store.appendAudit({
      runId: run.runId,
      action: "agent.invoked",
      message:
        "Lead routed mandatory Security specialist for change/release check (no low-risk skip)",
      actor: { kind: "agent", agentRole: "lead" },
      details: {
        mandatoryRoles: [...ANALYSIS_ROLES],
        securityTaskKind: SECURITY_TASK_KIND,
        skipAllowed: false,
      },
    });

    await this.dispatchUntilIdle(run.runId, runners);

    // Cross-cutting AI Red Teaming guardrails on analysis-wave AI outputs.
    // Findings flag Lead in real time so remediation can route before continuing.
    const analysisGuardrailFlags = await this.runAiRedTeamingGuardrailsForAnalysisWave(
      run.runId,
      runners,
      delegations,
      input,
    );

    // Checkpoint after specialist analysis stage.
    let analysisCheckpoint = await this.runCheckpoint(run.runId, "specialist_analysis", 0);
    await this.recordSecurityGate(run.runId);

    let cycle = 0;
    while (cycle < this.maxRemediationCycles && this.enableRemediation) {
      const current = await this.requireRun(run.runId);
      const prState = this.resolvePrDraftState(current);
      const assessment = assessReadiness({
        tasks: current.tasks,
        approvals: parseApprovalRecord(current.metadata.approvals),
        featureSignOffs: parseFeatureSignOffRecord(current.metadata.featureSignOffs),
        considerRemediation: true,
        prDraft: prState.prDraft,
        reviewReady: prState.reviewReady,
      });

      const checkpoints = parseCheckpointRecord(current.metadata.checkpoints).checkpoints;
      const latestCheckpoint = checkpoints[checkpoints.length - 1] ?? analysisCheckpoint;

      // After a remediation cycle, a passed post_remediation checkpoint ends the loop.
      // Further cycles only continue when the latest checkpoint still needs remediation
      // (e.g. testsPassed=false) — not merely because change_analyst impact is "high".
      if (cycle > 0) {
        if (
          latestCheckpoint.stage === "post_remediation" &&
          latestCheckpoint.status === "passed"
        ) {
          break;
        }
        if (!checkpointNeedsRemediation(latestCheckpoint)) {
          break;
        }
      } else {
        const needsRemediation =
          assessment.remediationRecommended ||
          checkpointNeedsRemediation(analysisCheckpoint) ||
          analysisGuardrailFlags.length > 0;
        if (!needsRemediation) break;
      }

      cycle += 1;
      const goals = this.buildRemediationGoals(assessment, analysisCheckpoint, current);
      for (const flag of analysisGuardrailFlags) {
        const msg = `AI Red Teaming realtime: ${flag.summary}`;
        if (!goals.includes(msg)) goals.push(msg);
      }

      await this.store.appendAudit({
        runId: run.runId,
        action: "remediation.cycle_started",
        message: `Remediation cycle ${cycle} started`,
        actor: { kind: "agent", agentRole: "lead" },
        details: { cycle, goals },
      });

      const { task: builderTask } = await this.store.addTask(run.runId, {
        name: `${ROLE_TASK_NAME.builder} (cycle ${cycle})`,
        agentRole: "builder",
        status: "ready",
        retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
        input: {
          remediationGoals: goals,
          baseBranch: input.target.baseRef ?? "main",
          relatedFindings: this.collectRelatedFindings(current.tasks),
          remediationCycle: cycle,
        },
      });
      delegations.push({
        taskId: builderTask.id,
        agentRole: "builder",
        rationale: `Remediation cycle ${cycle}`,
      });

      await this.dispatchUntilIdle(run.runId, runners);

      // AI Red Teaming on Builder + Cloud Agent (Coding/Testing/Review) prompts/outputs.
      await this.runAiRedTeamingGuardrailsForBuilderWave(
        run.runId,
        runners,
        delegations,
        input,
        builderTask.id,
        cycle,
      );

      // Checkpoint after cloud-agent / builder stage.
      const cloudCheckpoint = await this.runCheckpoint(run.runId, "cloud_agents", cycle);

      // Track / open PR from builder output (never merge).
      if (this.enablePrWorkflow) {
        await this.syncPullRequestFromBuilder(run.runId, input, builderTask.id);
      }

      // Dedicated post-Builder AI Red Teaming pass, then ATLAS/OWASP hard block.
      await this.runDedicatedPostBuilderAiRedTeaming(
        run.runId,
        runners,
        delegations,
        input,
        cycle,
      );
      await this.recordAiRedTeamingHardBlock(run.runId);

      // If cloud checkpoint fails remediably and we have cycles left, continue
      // after reverify so the next loop can rebuild — still reverify first.
      const reverifyRoles: SpecialistRole[] = ["standards", MANDATORY_SECURITY_ROLE];
      for (const role of reverifyRoles) {
        const afterBuilder = await this.requireRun(run.runId);
        const { task } = await this.store.addTask(run.runId, {
          name: `Reverify ${ROLE_TASK_NAME[role]} (cycle ${cycle})`,
          agentRole: role,
          status: "ready",
          dependsOn: [builderTask.id],
          retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
          input: {
            ...this.buildSpecialistInput(role, input, afterBuilder),
            reverify: true,
            remediationCycle: cycle,
            priorCheckpointId: cloudCheckpoint.id,
            ...(role === MANDATORY_SECURITY_ROLE
              ? { taskKind: SECURITY_TASK_KIND, mandatory: true }
              : {}),
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

      // Guardrail on reverify AI outputs (Standards / Security).
      await this.runAiRedTeamingGuardrailsForAnalysisWave(
        run.runId,
        runners,
        delegations,
        input,
        { onlyRoles: ["standards", "security"], labelSuffix: `reverify-c${cycle}` },
      );

      analysisCheckpoint = await this.runCheckpoint(run.runId, "post_remediation", cycle);
    }

    // When no remediation cycle ran, still run dedicated post-Builder-style pass
    // only if builder already present; otherwise hard-block evaluates analysis flags.
    if (cycle === 0) {
      await this.recordAiRedTeamingHardBlock(run.runId);
    }

    // Final PR status poll (interface for UI / gates).
    if (this.enablePrWorkflow) {
      await this.pollAllTrackedPullRequests(run.runId);
    }

    // Security must have a recorded result before human approval gates.
    await this.recordSecurityGate(run.runId);
    await this.recordAiRedTeamingHardBlock(run.runId);

    // Feature checklist sign-offs for AI-produced code — before merge/release gates.
    await this.requestFeatureSignOffsForNewFeatures(run.runId);

    // Human merge/release gates — modeled, never auto-approved / never auto-merged.
    await this.requestApproval(run.runId, "release", "Release decision requires human approval");
    await this.requestApproval(
      run.runId,
      "merge",
      "Merge decision requires human approval (never auto-merge)",
    );

    const finalRun = await this.requireRun(run.runId);
    const approvals = parseApprovalRecord(finalRun.metadata.approvals);
    const featureSignOffs = parseFeatureSignOffRecord(finalRun.metadata.featureSignOffs);
    const checkpoints = parseCheckpointRecord(finalRun.metadata.checkpoints);
    const pullRequests = parsePullRequestRecord(finalRun.metadata.pullRequests);
    const finalPrState = this.resolvePrDraftState(finalRun);
    const assessment = assessReadiness({
      tasks: finalRun.tasks,
      approvals,
      featureSignOffs,
      considerRemediation: this.enableRemediation,
      checkpoints,
      prDraft: finalPrState.prDraft,
      reviewReady: finalPrState.reviewReady,
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

    await this.store.completeTask(run.runId, leadTaskId, {
      ...(leadOutput as unknown as Record<string, unknown>),
      checkpoints,
      pullRequests,
      autoMerge: false,
    });

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
      featureSignOffs,
      checkpoints,
      pullRequests,
      dmSession: this.dmSession,
    };
  }

  /**
   * Detect Builder / Cloud Coding features and create pending checklist sign-offs.
   * Never auto-completes items.
   */
  async requestFeatureSignOffsForNewFeatures(runId: string): Promise<FeatureSignOffRecord> {
    const run = await this.requireRun(runId);
    const features = detectNewFeaturesFromTasks(run.tasks);
    if (features.length === 0) {
      return parseFeatureSignOffRecord(run.metadata.featureSignOffs);
    }

    for (const feature of features) {
      await this.store.appendAudit({
        runId,
        action: "feature.detected",
        message: `New feature detected from ${feature.sourceAgent}: ${feature.title}`,
        actor: { kind: "agent", agentRole: "lead" },
        details: {
          featureId: feature.id,
          sourceAgent: feature.sourceAgent,
          branch: feature.branch,
          prUrl: feature.prUrl,
          taskId: feature.taskId,
        },
      });
    }

    const checklists = createChecklistsForFeatures(features);
    const record = mergeFeatureSignOffRecords(
      parseFeatureSignOffRecord(run.metadata.featureSignOffs),
      checklists,
    );
    await this.store.update(runId, {
      metadata: { ...run.metadata, featureSignOffs: record },
    });

    for (const checklist of checklists) {
      await this.store.appendAudit({
        runId,
        action: "feature.signoff_requested",
        message: `Feature sign-off checklist requested (${checklist.kind}): ${checklist.feature.title}`,
        actor: { kind: "agent", agentRole: "lead" },
        details: {
          checklistId: checklist.id,
          kind: checklist.kind,
          featureId: checklist.feature.id,
          itemCount: checklist.items.length,
        },
      });
    }

    return record;
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
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      throw new Error(
        `Run ${runId} is ${run.status}; record approvals before the Lead completes the run, or use applyApprovalsToReport`,
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

    // Explicit merge-blocked audit when merge is approved still does not merge.
    if (updated.kind === "merge" && decision === "approved") {
      await this.store.appendAudit({
        runId,
        action: "pr.merge_blocked",
        message:
          "Merge approved by human gate — actual git merge is out of band (Release Desk never auto-merges)",
        actor: { kind: "system" },
        details: { gateId, autoMerge: false },
      });
    }

    const next = await this.requireRun(runId);
    const assessment = assessReadiness({
      tasks: next.tasks,
      approvals: record,
      featureSignOffs: parseFeatureSignOffRecord(next.metadata.featureSignOffs),
      checkpoints: parseCheckpointRecord(next.metadata.checkpoints),
    });
    return { run: next, gate: updated, assessment };
  }

  /**
   * Record a single checklist item sign-off on a live (non-terminal) run.
   * Never auto-signs remaining items.
   */
  async recordFeatureSignOffItem(
    runId: string,
    checklistId: string,
    itemId: FeatureSignOffItemId,
    opts?: { signedOffBy?: string; notes?: string },
  ): Promise<{
    run: RunContext;
    checklist: FeatureSignOffChecklist;
    assessment: ReadinessAssessment;
  }> {
    const run = await this.requireRun(runId);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      throw new Error(
        `Run ${runId} is ${run.status}; record feature sign-offs before the Lead completes the run, or use applyFeatureSignOffsToReport`,
      );
    }

    const record = parseFeatureSignOffRecord(run.metadata.featureSignOffs);
    const idx = record.checklists.findIndex((c) => c.id === checklistId);
    if (idx < 0) throw new Error(`Feature sign-off checklist ${checklistId} not found`);
    const existing = record.checklists[idx]!;
    const updated = signOffChecklistItem(existing, itemId, opts);
    record.checklists[idx] = updated;

    await this.store.update(runId, {
      metadata: { ...run.metadata, featureSignOffs: record },
    });
    await this.store.appendAudit({
      runId,
      action: "feature.signoff_item_recorded",
      message: `Feature checklist item signed off: ${itemId} on ${checklistId}`,
      actor: {
        kind: "human",
        ...(opts?.signedOffBy !== undefined ? { name: opts.signedOffBy } : {}),
      },
      details: {
        checklistId,
        itemId,
        featureId: updated.feature.id,
        checklistStatus: updated.status,
      },
    });

    if (updated.status === "completed") {
      await this.store.appendAudit({
        runId,
        action: "feature.signoff_completed",
        message: `Feature sign-off checklist completed: ${updated.feature.title}`,
        actor: {
          kind: "human",
          ...(updated.completedBy !== undefined ? { name: updated.completedBy } : {}),
        },
        details: { checklistId, featureId: updated.feature.id, kind: updated.kind },
      });
    }

    const next = await this.requireRun(runId);
    const assessment = assessReadiness({
      tasks: next.tasks,
      approvals: parseApprovalRecord(next.metadata.approvals),
      featureSignOffs: record,
      checkpoints: parseCheckpointRecord(next.metadata.checkpoints),
    });
    return { run: next, checklist: updated, assessment };
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
      featureSignOffs: report.featureSignOffs,
      checkpoints: report.checkpoints,
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

  /**
   * Apply feature checklist item sign-offs to a finished report (in-memory).
   * Explicit human/demo action — never called automatically by the Lead.
   */
  applyFeatureSignOffsToReport(
    report: ReleaseCheckReport,
    decisions: Array<{
      checklistId: string;
      /** Sign a single item; omit with `signOffAll: true` to complete the checklist. */
      itemId?: FeatureSignOffItemId;
      signOffAll?: boolean;
      signedOffBy?: string;
      notes?: string;
    }>,
  ): ReleaseCheckReport {
    let featureSignOffs: FeatureSignOffRecord = {
      checklists: report.featureSignOffs.checklists.map((c) => ({
        ...c,
        items: c.items.map((i) => ({ ...i })),
        feature: { ...c.feature },
      })),
    };

    for (const d of decisions) {
      const idx = featureSignOffs.checklists.findIndex((c) => c.id === d.checklistId);
      if (idx < 0) throw new Error(`Feature sign-off checklist ${d.checklistId} not found`);
      const existing = featureSignOffs.checklists[idx]!;
      const opts = {
        ...(d.signedOffBy !== undefined ? { signedOffBy: d.signedOffBy } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
      };
      if (d.signOffAll) {
        featureSignOffs.checklists[idx] = signOffEntireChecklist(existing, opts);
      } else if (d.itemId) {
        featureSignOffs.checklists[idx] = signOffChecklistItem(existing, d.itemId, opts);
      } else {
        throw new Error("itemId or signOffAll is required");
      }
    }

    const assessment = assessReadiness({
      tasks: report.run.tasks,
      approvals: report.approvals,
      featureSignOffs,
      checkpoints: report.checkpoints,
    });
    const leadOutput = LeadAgentOutputSchema.parse({
      ...report.leadOutput,
      readiness: assessment.readiness,
      blockingIssues: assessment.blockingIssues,
      remediationRecommended: assessment.remediationRecommended,
      summary: assessment.summary,
      completedAt: nowIso(),
    });
    return { ...report, featureSignOffs, assessment, leadOutput };
  }

  /** Poll status for all tracked PRs (public status-polling interface). */
  async pollPullRequestStatus(
    runId: string,
    prNumber?: number,
  ): Promise<TrackedPullRequest[]> {
    const run = await this.requireRun(runId);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      // Allow polling metadata via client without mutating terminal run —
      // return refreshed snapshots without store write.
      const record = parsePullRequestRecord(run.metadata.pullRequests);
      const targets = prNumber
        ? record.pullRequests.filter((p) => p.prNumber === prNumber)
        : record.pullRequests;
      const updated: TrackedPullRequest[] = [];
      for (const tracked of targets) {
        updated.push(await pollTrackedPullRequest(this.prClient, tracked));
      }
      return updated;
    }
    await this.pollAllTrackedPullRequests(runId, prNumber);
    const next = await this.requireRun(runId);
    return parsePullRequestRecord(next.metadata.pullRequests).pullRequests;
  }

  // --- internals ---

  private async requireRun(runId: string): Promise<RunContext> {
    const run = await this.store.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  }

  /** Persist mandatory Security participation gate evidence on the run. */
  private async recordSecurityGate(runId: string): Promise<void> {
    const run = await this.requireRun(runId);
    const gate = evaluateSecurityParticipation(run.tasks);
    await this.store.update(runId, {
      metadata: { ...run.metadata, securityGate: gate },
    });
    await this.store.appendAudit({
      runId,
      action: gate.satisfied ? "security.gate_evaluated" : "security.gate_blocked",
      message: gate.satisfied
        ? `Mandatory Security gate satisfied (task ${gate.taskId ?? "unknown"})`
        : (gate.blockingIssue ?? "Mandatory Security gate blocked readiness"),
      actor: { kind: "agent", agentRole: "lead" },
      details: { ...gate, skipAllowed: false },
      ...(gate.taskId !== undefined ? { taskId: gate.taskId } : {}),
    });
  }

  /** Draft vs review-ready PR state for AI Red Teaming hard-block exemption. */
  private resolvePrDraftState(run: RunContext): { prDraft: boolean; reviewReady: boolean } {
    const prs = parsePullRequestRecord(run.metadata.pullRequests).pullRequests;
    if (prs.length === 0) {
      // No PR yet — treat as not review-ready (hard block not forced).
      return { prDraft: false, reviewReady: false };
    }
    const latest = prs[prs.length - 1]!;
    const draft = latest.lastStatus?.raw?.draft === true;
    // TrackedPullRequest doesn't always carry draft; infer review-ready when open + not draft meta.
    const prDraft = draft === true;
    return { prDraft, reviewReady: !prDraft };
  }

  /**
   * Persist ATLAS/OWASP hard-block gate. Draft PRs are exempt; review-ready PRs block.
   */
  private async recordAiRedTeamingHardBlock(runId: string): Promise<void> {
    const run = await this.requireRun(runId);
    const prState = this.resolvePrDraftState(run);
    const gate = evaluateAiRedTeamingHardBlock({
      tasks: run.tasks,
      prDraft: prState.prDraft,
      reviewReady: prState.reviewReady,
    });
    await this.store.update(runId, {
      metadata: { ...run.metadata, aiRedTeamingHardBlock: gate },
    });
    const action = gate.blocked
      ? "ai_red_teaming.hard_block_blocked"
      : gate.status === "exempt_draft"
        ? "ai_red_teaming.hard_block_exempt_draft"
        : "ai_red_teaming.hard_block_evaluated";
    await this.store.appendAudit({
      runId,
      action,
      message: gate.blocked
        ? (gate.blockingIssue ?? "AI Red Teaming hard-blocked review-ready PR")
        : gate.status === "exempt_draft"
          ? (gate.blockingIssue ?? "AI Red Teaming findings present — draft PR exempt")
          : `AI Red Teaming hard block ${gate.status}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: { ...gate },
      ...(gate.taskId !== undefined ? { taskId: gate.taskId } : {}),
    });
  }

  /**
   * Flag Lead in real time when AI Red Teaming finds issues mid-flow.
   * Persists flag metadata + audit so remediation can route before continuing.
   */
  private async flagLeadRealtimeFromAiRedTeaming(input: {
    runId: string;
    taskId: string;
    touchpoint: AiRedTeamingTouchpoint;
    passKind: AiRedTeamingPassKind;
    summary: string;
    findingIds: string[];
    releaseBlockingCount: number;
  }): Promise<AiRedTeamingLeadFlag> {
    const run = await this.requireRun(input.runId);
    const record = parseAiRedTeamingFlagRecord(run.metadata.aiRedTeamingFlags);
    const flag: AiRedTeamingLeadFlag = {
      id: `ai_rt_flag_${record.flags.length + 1}_${Date.now()}`,
      at: nowIso(),
      touchpoint: input.touchpoint,
      passKind: input.passKind,
      taskId: input.taskId,
      findingIds: input.findingIds,
      releaseBlockingCount: input.releaseBlockingCount,
      summary: input.summary,
      remediationRouted: false,
    };
    record.flags.push(flag);
    await this.store.update(input.runId, {
      metadata: { ...run.metadata, aiRedTeamingFlags: record },
    });
    await this.store.appendAudit({
      runId: input.runId,
      action: "ai_red_teaming.flagged_lead",
      message: `AI Red Teaming flagged Lead realtime @ ${input.touchpoint}: ${input.summary}`,
      actor: { kind: "agent", agentRole: AI_RED_TEAMING_ROLE },
      taskId: input.taskId,
      details: { ...flag },
    });
    this.dmSession = replyAsLead(
      this.dmSession,
      `AI Red Teaming realtime flag @ ${input.touchpoint} — routing remediation before continuing`,
    );
    return flag;
  }

  private async markAiRedTeamingFlagRemediationRouted(
    runId: string,
    flagId: string,
  ): Promise<void> {
    const run = await this.requireRun(runId);
    const record = parseAiRedTeamingFlagRecord(run.metadata.aiRedTeamingFlags);
    const idx = record.flags.findIndex((f) => f.id === flagId);
    if (idx < 0) return;
    record.flags[idx] = { ...record.flags[idx]!, remediationRouted: true };
    await this.store.update(runId, {
      metadata: { ...run.metadata, aiRedTeamingFlags: record },
    });
    await this.store.appendAudit({
      runId,
      action: "ai_red_teaming.remediation_routed",
      message: `Lead routed remediation for AI Red Teaming flag ${flagId}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: { flagId },
    });
  }

  private subjectTextFromTask(task: TaskRecord): string {
    const out = task.output ?? {};
    const parts = [
      asString(out.summary),
      asString(out.releaseNotesDraft),
      asString(task.input?.prompt),
      JSON.stringify(out.findings ?? []),
      JSON.stringify(out.workItems ?? []),
    ].filter(Boolean);
    return parts.join("\n");
  }

  /**
   * Schedule + dispatch one AI Red Teaming pass; flag Lead realtime on findings.
   */
  private async runAiRedTeamingPass(opts: {
    runId: string;
    runners: Record<SpecialistRole, AgentRunner>;
    delegations: LeadDelegation[];
    input: StartReleaseCheckInput;
    touchpoint: AiRedTeamingTouchpoint;
    passKind: AiRedTeamingPassKind;
    subjectText: string;
    subjectMeta?: Record<string, unknown>;
    nameSuffix?: string;
    injectFindings?: unknown[];
  }): Promise<{ taskId: string; flagged: boolean; flag?: AiRedTeamingLeadFlag }> {
    const {
      runId,
      runners,
      delegations,
      input,
      touchpoint,
      passKind,
      subjectText,
      subjectMeta,
      nameSuffix,
      injectFindings,
    } = opts;

    await this.store.appendAudit({
      runId,
      action: "ai_red_teaming.guardrail_started",
      message: `AI Red Teaming ${passKind} starting @ ${touchpoint}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: { touchpoint, passKind, taskKind: AI_RED_TEAMING_TASK_KIND },
    });

    const { task } = await this.store.addTask(runId, {
      name: nameSuffix
        ? `AI Red Teaming (${passKind}/${touchpoint}/${nameSuffix})`
        : `AI Red Teaming (${passKind}/${touchpoint})`,
      agentRole: AI_RED_TEAMING_ROLE,
      status: "ready",
      retry: { attempt: 0, maxAttempts: this.defaultMaxAttempts },
      input: {
        repository: input.target.repository,
        touchpoint,
        passKind,
        subjectText,
        subjectMeta: subjectMeta ?? {},
        taskKind: AI_RED_TEAMING_TASK_KIND,
        ...(injectFindings ? { injectFindings } : {}),
      },
    });
    delegations.push({
      taskId: task.id,
      agentRole: AI_RED_TEAMING_ROLE,
      rationale: `AI Red Teaming ${passKind} @ ${touchpoint}`,
    });

    await this.dispatchUntilIdle(runId, runners);

    const after = await this.requireRun(runId);
    const completed = after.tasks.find((t) => t.id === task.id);
    const out = completed?.output ?? {};
    const releaseBlockingCount =
      typeof out.releaseBlockingCount === "number" ? out.releaseBlockingCount : 0;
    const flagLeadRealtime = out.flagLeadRealtime === true || releaseBlockingCount > 0;
    const findings = Array.isArray(out.findings) ? out.findings : [];
    const findingIds = findings
      .map((f) => (f && typeof f === "object" ? (f as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string");

    await this.store.appendAudit({
      runId,
      action: "ai_red_teaming.guardrail_completed",
      message: asString(out.summary) ?? `AI Red Teaming ${passKind} @ ${touchpoint} completed`,
      actor: { kind: "agent", agentRole: AI_RED_TEAMING_ROLE },
      taskId: task.id,
      details: {
        touchpoint,
        passKind,
        releaseBlockingCount,
        flagLeadRealtime,
        hardBlockRecommended: out.hardBlockRecommended === true,
      },
    });

    if (!flagLeadRealtime) {
      return { taskId: task.id, flagged: false };
    }

    const flag = await this.flagLeadRealtimeFromAiRedTeaming({
      runId,
      taskId: task.id,
      touchpoint,
      passKind,
      summary:
        asString(out.summary) ??
        `AI Red Teaming: ${releaseBlockingCount} release-blocking finding(s) @ ${touchpoint}`,
      findingIds,
      releaseBlockingCount,
    });
    await this.markAiRedTeamingFlagRemediationRouted(runId, flag.id);
    return { taskId: task.id, flagged: true, flag };
  }

  /** Guardrails on analysis-wave (or reverify) AI specialist outputs. */
  private async runAiRedTeamingGuardrailsForAnalysisWave(
    runId: string,
    runners: Record<SpecialistRole, AgentRunner>,
    delegations: LeadDelegation[],
    input: StartReleaseCheckInput,
    opts?: { onlyRoles?: Array<"change_analyst" | "standards" | "security">; labelSuffix?: string },
  ): Promise<AiRedTeamingLeadFlag[]> {
    const run = await this.requireRun(runId);
    const roles = opts?.onlyRoles ?? ["change_analyst", "standards", "security"];
    const flags: AiRedTeamingLeadFlag[] = [];
    for (const role of roles) {
      if (!AI_OUTPUT_TOUCHPOINTS.includes(role)) continue;
      const task = [...run.tasks]
        .reverse()
        .find((t) => t.agentRole === role && t.status === "completed");
      if (!task) continue;
      const result = await this.runAiRedTeamingPass({
        runId,
        runners,
        delegations,
        input,
        touchpoint: role,
        passKind: "guardrail",
        subjectText: this.subjectTextFromTask(task),
        subjectMeta: { sourceAgent: role },
        ...(opts?.labelSuffix ? { nameSuffix: opts.labelSuffix } : {}),
      });
      if (result.flag) flags.push(result.flag);
    }
    return flags;
  }

  /** Guardrails on Builder + Cloud Coding/Testing/Review AI prompts/outputs. */
  private async runAiRedTeamingGuardrailsForBuilderWave(
    runId: string,
    runners: Record<SpecialistRole, AgentRunner>,
    delegations: LeadDelegation[],
    input: StartReleaseCheckInput,
    builderTaskId: string,
    cycle: number,
  ): Promise<AiRedTeamingLeadFlag[]> {
    const run = await this.requireRun(runId);
    const builder = run.tasks.find((t) => t.id === builderTaskId);
    const flags: AiRedTeamingLeadFlag[] = [];
    if (builder && builder.status === "completed") {
      const builderResult = await this.runAiRedTeamingPass({
        runId,
        runners,
        delegations,
        input,
        touchpoint: "builder",
        passKind: "guardrail",
        subjectText: this.subjectTextFromTask(builder),
        subjectMeta: { sourceAgent: "builder" },
        nameSuffix: `c${cycle}`,
      });
      if (builderResult.flag) flags.push(builderResult.flag);

      const workItems = Array.isArray(builder.output?.workItems)
        ? builder.output!.workItems
        : [];
      for (const item of workItems) {
        if (!item || typeof item !== "object") continue;
        const kind = (item as { kind?: unknown }).kind;
        const touchpoint: AiRedTeamingTouchpoint | undefined =
          kind === "coding"
            ? "cloud_coding"
            : kind === "testing"
              ? "cloud_testing"
              : kind === "review"
                ? "cloud_review"
                : undefined;
        if (!touchpoint) continue;
        const notes = asString((item as { notes?: unknown }).notes) ?? "";
        const prompt = asString((item as { prompt?: unknown }).prompt) ?? notes;
        const cloudResult = await this.runAiRedTeamingPass({
          runId,
          runners,
          delegations,
          input,
          touchpoint,
          passKind: "guardrail",
          subjectText: prompt || JSON.stringify(item),
          subjectMeta: { sourceAgent: `cloud:${kind}` },
          nameSuffix: `c${cycle}`,
        });
        if (cloudResult.flag) flags.push(cloudResult.flag);
      }
    }
    return flags;
  }

  /** Dedicated post-Builder AI Red Teaming pass (before ATLAS/OWASP hard block). */
  private async runDedicatedPostBuilderAiRedTeaming(
    runId: string,
    runners: Record<SpecialistRole, AgentRunner>,
    delegations: LeadDelegation[],
    input: StartReleaseCheckInput,
    cycle: number,
  ): Promise<void> {
    const run = await this.requireRun(runId);
    const prState = this.resolvePrDraftState(run);
    const builders = run.tasks.filter((t) => t.agentRole === "builder" && t.status === "completed");
    const latestBuilder = builders[builders.length - 1];
    const subjectText = latestBuilder
      ? this.subjectTextFromTask(latestBuilder)
      : `Post-builder AI Red Teaming for ${input.target.repository}`;

    await this.runAiRedTeamingPass({
      runId,
      runners,
      delegations,
      input,
      touchpoint: "post_builder",
      passKind: "post_builder",
      subjectText,
      subjectMeta: {
        sourceAgent: "builder",
        prDraft: prState.prDraft,
        reviewReady: prState.reviewReady,
      },
      nameSuffix: `c${cycle}`,
    });

    // Explicit hard-block evaluation pass (same specialist; passKind=hard_block).
    await this.runAiRedTeamingPass({
      runId,
      runners,
      delegations,
      input,
      touchpoint: "post_builder",
      passKind: "hard_block",
      subjectText,
      subjectMeta: {
        sourceAgent: "builder",
        prDraft: prState.prDraft,
        reviewReady: prState.reviewReady,
      },
      nameSuffix: `hard-block-c${cycle}`,
    });
  }

  private async runCheckpoint(
    runId: string,
    stage: CheckpointStage,
    cycle: number,
  ): Promise<CheckpointResult> {
    const run = await this.requireRun(runId);
    const result = evaluateCheckpoint({
      stage,
      tasks: run.tasks,
      cycle,
      approvals: parseApprovalRecord(run.metadata.approvals),
    });

    const record = parseCheckpointRecord(run.metadata.checkpoints);
    record.checkpoints.push(result);
    await this.store.update(runId, {
      metadata: { ...run.metadata, checkpoints: record },
    });

    await this.store.appendAudit({
      runId,
      action: result.status === "passed" ? "checkpoint.passed" : "checkpoint.failed",
      message: result.summary,
      actor: { kind: "agent", agentRole: "lead" },
      details: {
        checkpointId: result.id,
        stage: result.stage,
        cycle: result.cycle,
        issues: result.issues,
        evidence: result.evidence,
      },
    });

    return result;
  }

  private buildRemediationGoals(
    assessment: ReadinessAssessment,
    checkpoint: CheckpointResult,
    run: RunContext,
  ): string[] {
    const goals: string[] = [];
    if (assessment.blockingIssues.length) {
      goals.push(...assessment.blockingIssues);
    }
    for (const issue of checkpoint.issues.filter((i) => i.remediable)) {
      if (!goals.includes(issue.message)) goals.push(issue.message);
    }
    // Include failed cloud tests from latest builder if present.
    const builders = run.tasks.filter((t) => t.agentRole === "builder");
    const latestBuilder = builders[builders.length - 1];
    if (latestBuilder?.output?.testsPassed === false) {
      const msg = "Re-run / fix failing tests from Cloud Agent testing stage";
      if (!goals.includes(msg)) goals.push(msg);
    }
    if (goals.length === 0) {
      goals.push("Address specialist findings before release");
    }
    return goals;
  }

  private async syncPullRequestFromBuilder(
    runId: string,
    input: StartReleaseCheckInput,
    builderTaskId: string,
  ): Promise<void> {
    const run = await this.requireRun(runId);
    const builder = run.tasks.find((t) => t.id === builderTaskId);
    if (!builder || builder.status !== "completed") return;

    const out = builder.output ?? {};
    const proposedPrUrl = asString(out.proposedPrUrl);
    const proposedBranch =
      asString(out.proposedBranch) ??
      asString((out.branchMetadata as { proposedBranch?: unknown } | undefined)?.proposedBranch);
    const baseBranch =
      asString((out.branchMetadata as { baseBranch?: unknown } | undefined)?.baseBranch) ??
      input.target.baseRef ??
      "main";

    const record = parsePullRequestRecord(run.metadata.pullRequests);
    let tracked: TrackedPullRequest;

    try {
      if (proposedPrUrl) {
        tracked = await trackExistingPullRequest(this.prClient, {
          repository: input.target.repository,
          prUrl: proposedPrUrl,
          ...(proposedBranch ? { head: proposedBranch } : {}),
          base: baseBranch,
          title: `Release Desk remediation — ${input.goal}`,
          source: "builder",
        });
        await this.store.appendAudit({
          runId,
          action: "pr.tracked",
          message: `Tracked Builder PR ${tracked.url}`,
          actor: { kind: "agent", agentRole: "lead" },
          details: {
            prNumber: tracked.prNumber,
            url: tracked.url,
            clientMode: tracked.clientMode,
            autoMerge: false,
          },
        });
      } else if (proposedBranch) {
        tracked = await openAndTrackPullRequest(this.prClient, {
          repository: input.target.repository,
          title: `[Release Desk] ${input.goal}`,
          body: [
            `Automated remediation PR opened by Lead (client=${this.prClient.mode}).`,
            "",
            "**Never auto-merged.** Human merge + release approval gates required.",
            "",
            `Builder task: ${builderTaskId}`,
            ...(this.prClient.mode === "mock" ? [formatMockNote("MOCK GitHub PR")] : []),
          ].join("\n"),
          head: proposedBranch,
          base: baseBranch,
          source: "lead",
        });
        await this.store.appendAudit({
          runId,
          action: "pr.opened",
          message: `Opened PR ${tracked.url} for branch ${proposedBranch}`,
          actor: { kind: "agent", agentRole: "lead" },
          details: {
            prNumber: tracked.prNumber,
            url: tracked.url,
            head: proposedBranch,
            base: baseBranch,
            clientMode: tracked.clientMode,
            autoMerge: false,
          },
        });
      } else {
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.appendAudit({
        runId,
        action: "pr.merge_blocked",
        message: `PR workflow failed (non-fatal): ${message}`,
        actor: { kind: "system" },
        details: { error: message, autoMerge: false },
      });
      return;
    }

    // Refuse any attempt to auto-merge via client.
    try {
      await this.prClient.mergePullRequest(tracked.repository, tracked.prNumber);
    } catch {
      await this.store.appendAudit({
        runId,
        action: "pr.merge_blocked",
        message: `Auto-merge refused for PR #${tracked.prNumber}`,
        actor: { kind: "system" },
        details: {
          prNumber: tracked.prNumber,
          url: tracked.url,
          autoMerge: false,
          humanMergeGateRequired: true,
        },
      });
    }

    const polled = await pollTrackedPullRequest(this.prClient, tracked);
    await this.store.appendAudit({
      runId,
      action: "pr.status_polled",
      message: `Polled PR #${polled.prNumber}: ${polled.lastStatus?.checkSummary ?? "ok"}`,
      actor: { kind: "agent", agentRole: "lead" },
      details: {
        prNumber: polled.prNumber,
        status: polled.lastStatus,
        autoMerge: false,
      },
    });

    // Replace if same number already tracked, else append.
    const idx = record.pullRequests.findIndex((p) => p.prNumber === polled.prNumber);
    if (idx >= 0) record.pullRequests[idx] = polled;
    else record.pullRequests.push(polled);

    const latest = await this.requireRun(runId);
    await this.store.update(runId, {
      metadata: { ...latest.metadata, pullRequests: record },
    });
  }

  private async pollAllTrackedPullRequests(runId: string, prNumber?: number): Promise<void> {
    const run = await this.requireRun(runId);
    const record = parsePullRequestRecord(run.metadata.pullRequests);
    if (record.pullRequests.length === 0) return;

    const updated: TrackedPullRequest[] = [];
    for (const tracked of record.pullRequests) {
      if (prNumber !== undefined && tracked.prNumber !== prNumber) {
        updated.push(tracked);
        continue;
      }
      const polled = await pollTrackedPullRequest(this.prClient, tracked);
      updated.push(polled);
      await this.store.appendAudit({
        runId,
        action: "pr.status_polled",
        message: `Polled PR #${polled.prNumber}: ${polled.lastStatus?.checkSummary ?? "ok"}`,
        actor: { kind: "agent", agentRole: "lead" },
        details: {
          prNumber: polled.prNumber,
          status: polled.lastStatus,
          autoMerge: false,
        },
      });
    }

    const latest = await this.requireRun(runId);
    await this.store.update(runId, {
      metadata: {
        ...latest.metadata,
        pullRequests: { pullRequests: updated },
      },
    });
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

      const retrying = run.tasks.filter(
        (t) => isSpecialistRole(t.agentRole) && t.status === "retrying",
      );
      const byId = new Map<string, TaskRecord>();
      for (const t of [...candidates, ...retrying]) byId.set(t.id, t);
      const toRun = [...byId.values()];

      if (toRun.length === 0) return;

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
