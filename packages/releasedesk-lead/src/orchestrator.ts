import {
  assertMandatoryAnalysisRoles,
  createAiFrameworkWaiver,
  evaluateSecurityParticipation,
  formatMockNote,
  LeadAgentOutputSchema,
  listReadyTasks,
  MANDATORY_ANALYSIS_ROLES,
  MANDATORY_SECURITY_ROLE,
  nowIso,
  parseAiFrameworkWaiverRecord,
  SECURITY_TASK_KIND,
  type AiFrameworkWaiverRecord,
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
  assertPrMergeAllowedForAiFrameworks,
  describePrClientMode,
  evaluatePrAiFrameworkMergeGate,
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
  /** Explicit human waivers for MITRE ATLAS / OWASP LLM Top 10 findings. */
  aiFrameworkWaivers: AiFrameworkWaiverRecord;
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
};

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
        aiFrameworkWaivers: { waivers: [] } satisfies AiFrameworkWaiverRecord,
        checkpoints: { checkpoints: [] } satisfies CheckpointRecord,
        pullRequests: { pullRequests: [] } satisfies PullRequestRecord,
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

    // Checkpoint after specialist analysis stage.
    let analysisCheckpoint = await this.runCheckpoint(run.runId, "specialist_analysis", 0);
    await this.recordSecurityGate(run.runId);

    let cycle = 0;
    while (cycle < this.maxRemediationCycles && this.enableRemediation) {
      const current = await this.requireRun(run.runId);
      const assessment = this.assessRunReadiness(current, { considerRemediation: true });

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
          checkpointNeedsRemediation(analysisCheckpoint);
        if (!needsRemediation) break;
      }

      cycle += 1;
      const goals = this.buildRemediationGoals(assessment, analysisCheckpoint, current);

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

      // Checkpoint after cloud-agent / builder stage.
      const cloudCheckpoint = await this.runCheckpoint(run.runId, "cloud_agents", cycle);

      // Track / open PR from builder output (never merge).
      if (this.enablePrWorkflow) {
        await this.syncPullRequestFromBuilder(run.runId, input, builderTask.id);
      }

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

      analysisCheckpoint = await this.runCheckpoint(run.runId, "post_remediation", cycle);
    }

    // Final PR status poll (interface for UI / gates).
    if (this.enablePrWorkflow) {
      await this.pollAllTrackedPullRequests(run.runId);
    }

    // Security must have a recorded result before human approval gates.
    await this.recordSecurityGate(run.runId);

    // ATLAS/OWASP hard merge gate — before human merge/release can be considered.
    await this.recordAiFrameworkMergeGate(run.runId);

    // Feature checklist sign-offs for AI-produced code — before merge/release gates.
    await this.requestFeatureSignOffsForNewFeatures(run.runId);

    // Human merge/release gates — modeled, never auto-approved / never auto-merged.
    // Merge gate reason notes ATLAS/OWASP prerequisite for open-for-review PRs.
    const preApproval = await this.requireRun(run.runId);
    const preMergeGate = evaluatePrAiFrameworkMergeGate({
      tasks: preApproval.tasks,
      waivers: preApproval.metadata.aiFrameworkWaivers,
      ...this.latestPrDraftState(preApproval),
    });
    await this.requestApproval(
      run.runId,
      "release",
      preMergeGate.hasUnresolvedFindings
        ? "Release decision requires human approval (ATLAS/OWASP findings must be resolved or waived first)"
        : "Release decision requires human approval",
    );
    await this.requestApproval(
      run.runId,
      "merge",
      preMergeGate.blocksPrMerge
        ? "Merge blocked until ATLAS/OWASP findings are resolved or human-waived (open-for-review PR); then human merge approval (never auto-merge)"
        : "Merge decision requires human approval (never auto-merge)",
    );

    const finalRun = await this.requireRun(run.runId);
    const approvals = parseApprovalRecord(finalRun.metadata.approvals);
    const featureSignOffs = parseFeatureSignOffRecord(finalRun.metadata.featureSignOffs);
    const aiFrameworkWaivers = parseAiFrameworkWaiverRecord(
      finalRun.metadata.aiFrameworkWaivers,
    );
    const checkpoints = parseCheckpointRecord(finalRun.metadata.checkpoints);
    const pullRequests = parsePullRequestRecord(finalRun.metadata.pullRequests);
    const prMeta = this.latestPrDraftState(finalRun);
    const assessment = assessReadiness({
      tasks: finalRun.tasks,
      approvals,
      featureSignOffs,
      aiFrameworkWaivers,
      considerRemediation: this.enableRemediation,
      checkpoints,
      ...prMeta,
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
      aiFrameworkWaivers,
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
      const nextForGate = await this.requireRun(runId);
      const mergeGate = evaluatePrAiFrameworkMergeGate({
        tasks: nextForGate.tasks,
        waivers: nextForGate.metadata.aiFrameworkWaivers,
        ...this.latestPrDraftState(nextForGate),
      });
      if (mergeGate.blocksPrMerge) {
        await this.store.appendAudit({
          runId,
          action: "security.framework_merge_blocked",
          message:
            mergeGate.blockingIssue ??
            "ATLAS/OWASP findings block repository PR merge on open-for-review PR",
          actor: { kind: "system" },
          details: { ...mergeGate, gateId, autoMerge: false },
        });
      }
      await this.store.appendAudit({
        runId,
        action: "pr.merge_blocked",
        message: mergeGate.blocksPrMerge
          ? "Merge gate approved but ATLAS/OWASP hard findings still block repository PR merge (open for review)"
          : "Merge approved by human gate — actual git merge is out of band (Release Desk never auto-merges)",
        actor: { kind: "system" },
        details: { gateId, autoMerge: false, aiFrameworkBlocksMerge: mergeGate.blocksPrMerge },
      });
    }

    const next = await this.requireRun(runId);
    const assessment = this.assessRunReadiness(next, { approvals: record });
    return { run: next, gate: updated, assessment };
  }

  /**
   * Explicit human waiver for a MITRE ATLAS / OWASP LLM Top 10 finding.
   * Never auto-waived. Clears merge block only for waived finding ids.
   */
  async recordAiFrameworkWaiver(
    runId: string,
    input: {
      findingId: string;
      waivedBy: string;
      reason: string;
      frameworks?: Array<"mitre_atlas" | "owasp_llm_top_10">;
    },
  ): Promise<{
    run: RunContext;
    waivers: AiFrameworkWaiverRecord;
    assessment: ReadinessAssessment;
  }> {
    const run = await this.requireRun(runId);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      throw new Error(
        `Run ${runId} is ${run.status}; record ATLAS/OWASP waivers before the Lead completes the run, or use applyAiFrameworkWaiversToReport`,
      );
    }
    const record = parseAiFrameworkWaiverRecord(run.metadata.aiFrameworkWaivers);
    const waiver = createAiFrameworkWaiver({
      findingId: input.findingId,
      waivedBy: input.waivedBy,
      reason: input.reason,
      frameworks: input.frameworks ?? ["mitre_atlas", "owasp_llm_top_10"],
    });
    record.waivers.push(waiver);
    await this.store.update(runId, {
      metadata: { ...run.metadata, aiFrameworkWaivers: record },
    });
    await this.store.appendAudit({
      runId,
      action: "security.framework_waiver_recorded",
      message: `Human waived ATLAS/OWASP finding ${input.findingId}`,
      actor: { kind: "human", name: input.waivedBy },
      details: { ...waiver },
    });
    const next = await this.requireRun(runId);
    return {
      run: next,
      waivers: record,
      assessment: this.assessRunReadiness(next, { aiFrameworkWaivers: record }),
    };
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
    const assessment = this.assessRunReadiness(next, { featureSignOffs: record });
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
    const prMeta = this.latestPrDraftStateFromRecord(report.pullRequests);
    const assessment = assessReadiness({
      tasks: report.run.tasks,
      approvals,
      featureSignOffs: report.featureSignOffs,
      aiFrameworkWaivers: report.aiFrameworkWaivers,
      checkpoints: report.checkpoints,
      ...prMeta,
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

  /** In-memory ATLAS/OWASP waivers on a finished report. */
  applyAiFrameworkWaiversToReport(
    report: ReleaseCheckReport,
    waivers: Array<{
      findingId: string;
      waivedBy: string;
      reason: string;
      frameworks?: Array<"mitre_atlas" | "owasp_llm_top_10">;
    }>,
  ): ReleaseCheckReport {
    const aiFrameworkWaivers: AiFrameworkWaiverRecord = {
      waivers: [
        ...report.aiFrameworkWaivers.waivers,
        ...waivers.map((w) =>
          createAiFrameworkWaiver({
            findingId: w.findingId,
            waivedBy: w.waivedBy,
            reason: w.reason,
            frameworks: w.frameworks ?? ["mitre_atlas", "owasp_llm_top_10"],
          }),
        ),
      ],
    };
    const prMeta = this.latestPrDraftStateFromRecord(report.pullRequests);
    const assessment = assessReadiness({
      tasks: report.run.tasks,
      approvals: report.approvals,
      featureSignOffs: report.featureSignOffs,
      aiFrameworkWaivers,
      checkpoints: report.checkpoints,
      ...prMeta,
    });
    const leadOutput = LeadAgentOutputSchema.parse({
      ...report.leadOutput,
      readiness: assessment.readiness,
      blockingIssues: assessment.blockingIssues,
      remediationRecommended: assessment.remediationRecommended,
      summary: assessment.summary,
      completedAt: nowIso(),
    });
    return { ...report, aiFrameworkWaivers, assessment, leadOutput };
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

    const prMeta = this.latestPrDraftStateFromRecord(report.pullRequests);
    const assessment = assessReadiness({
      tasks: report.run.tasks,
      approvals: report.approvals,
      featureSignOffs,
      aiFrameworkWaivers: report.aiFrameworkWaivers,
      checkpoints: report.checkpoints,
      ...prMeta,
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

  private latestPrDraftState(run: RunContext): {
    prDraft: boolean | null;
    prState: "open" | "closed" | "merged" | null;
  } {
    return this.latestPrDraftStateFromRecord(
      parsePullRequestRecord(run.metadata.pullRequests),
    );
  }

  private latestPrDraftStateFromRecord(record: PullRequestRecord): {
    prDraft: boolean | null;
    prState: "open" | "closed" | "merged" | null;
  } {
    const prs = record.pullRequests;
    if (prs.length === 0) return { prDraft: null, prState: null };
    const latest = prs[prs.length - 1]!;
    return {
      prDraft: latest.draft,
      prState: (latest.lastStatus?.state as "open" | "closed" | "merged" | undefined) ?? "open",
    };
  }

  private assessRunReadiness(
    run: RunContext,
    overrides?: {
      approvals?: ApprovalRecord;
      featureSignOffs?: FeatureSignOffRecord;
      aiFrameworkWaivers?: AiFrameworkWaiverRecord;
      considerRemediation?: boolean;
    },
  ): ReadinessAssessment {
    const prMeta = this.latestPrDraftState(run);
    return assessReadiness({
      tasks: run.tasks,
      approvals: overrides?.approvals ?? parseApprovalRecord(run.metadata.approvals),
      featureSignOffs:
        overrides?.featureSignOffs ??
        parseFeatureSignOffRecord(run.metadata.featureSignOffs),
      aiFrameworkWaivers:
        overrides?.aiFrameworkWaivers ??
        parseAiFrameworkWaiverRecord(run.metadata.aiFrameworkWaivers),
      checkpoints: parseCheckpointRecord(run.metadata.checkpoints),
      considerRemediation: overrides?.considerRemediation,
      ...prMeta,
    });
  }

  /** Persist ATLAS/OWASP merge gate; blocks open-for-review PR merge when unresolved. */
  private async recordAiFrameworkMergeGate(runId: string): Promise<void> {
    const run = await this.requireRun(runId);
    const gate = evaluatePrAiFrameworkMergeGate({
      tasks: run.tasks,
      waivers: run.metadata.aiFrameworkWaivers,
      ...this.latestPrDraftState(run),
    });
    await this.store.update(runId, {
      metadata: { ...run.metadata, aiFrameworkMergeGate: gate },
    });

    if (gate.hasUnresolvedFindings) {
      await this.store.appendAudit({
        runId,
        action: "security.framework_findings",
        message: `MITRE ATLAS / OWASP LLM Top 10: ${gate.unresolvedFindingIds.length} unresolved hard-fail finding(s)`,
        actor: { kind: "agent", agentRole: "lead" },
        details: { ...gate },
      });
    }

    if (gate.blocksPrMerge) {
      await this.store.appendAudit({
        runId,
        action: "security.framework_merge_blocked",
        message:
          gate.blockingIssue ??
          "ATLAS/OWASP findings block repository PR merge (open for review)",
        actor: { kind: "agent", agentRole: "lead" },
        details: { ...gate, draftExempt: false },
      });
      // Refuse merge attempt for every tracked open-for-review PR.
      const prs = parsePullRequestRecord(run.metadata.pullRequests).pullRequests;
      for (const tracked of prs) {
        if (tracked.draft) continue;
        try {
          assertPrMergeAllowedForAiFrameworks({
            tasks: run.tasks,
            waivers: run.metadata.aiFrameworkWaivers,
            prDraft: tracked.draft,
            prState: tracked.lastStatus?.state ?? "open",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.store.appendAudit({
            runId,
            action: "pr.merge_blocked",
            message: `Repository PR #${tracked.prNumber} merge blocked by ATLAS/OWASP: ${message}`,
            actor: { kind: "system" },
            details: {
              prNumber: tracked.prNumber,
              url: tracked.url,
              draft: tracked.draft,
              autoMerge: false,
              aiFrameworkBlocksMerge: true,
            },
          });
        }
      }
    } else if (gate.draftExempt && gate.hasUnresolvedFindings) {
      await this.store.appendAudit({
        runId,
        action: "security.framework_findings",
        message:
          "ATLAS/OWASP findings present but draft PR is exempt from merge block (Security still failed)",
        actor: { kind: "agent", agentRole: "lead" },
        details: { ...gate },
      });
    }
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

    // Refuse any attempt to auto-merge via client; also enforce ATLAS/OWASP on open PRs.
    const runForMerge = await this.requireRun(runId);
    try {
      assertPrMergeAllowedForAiFrameworks({
        tasks: runForMerge.tasks,
        waivers: runForMerge.metadata.aiFrameworkWaivers,
        prDraft: tracked.draft,
        prState: "open",
      });
      await this.prClient.mergePullRequest(tracked.repository, tracked.prNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aiBlocked = /ATLAS|OWASP|framework/i.test(message);
      await this.store.appendAudit({
        runId,
        action: aiBlocked ? "security.framework_merge_blocked" : "pr.merge_blocked",
        message: aiBlocked
          ? `Repository PR #${tracked.prNumber} merge blocked by ATLAS/OWASP: ${message}`
          : `Auto-merge refused for PR #${tracked.prNumber}`,
        actor: { kind: "system" },
        details: {
          prNumber: tracked.prNumber,
          url: tracked.url,
          draft: tracked.draft,
          autoMerge: false,
          humanMergeGateRequired: true,
          aiFrameworkBlocksMerge: aiBlocked,
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
