import {
  createMockMeta,
  formatMockNote,
  nowIso,
  BuilderAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import type { CloudAgentHandoff } from "./builder-types.js";
import {
  describeCloudClientMode,
  dispatchCloudAgentPipeline,
  resolveCloudAgentClient,
} from "./cloud/index.js";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";

export type { CloudAgentHandoff } from "./builder-types.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function parseRelatedFindings(value: unknown): Array<{
  sourceAgent: string;
  summary: string;
  evidenceIds: string[];
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const sourceAgent = String((item as { sourceAgent?: unknown }).sourceAgent ?? "lead");
      const summary = String((item as { summary?: unknown }).summary ?? "");
      const evidenceIds = asStringArray((item as { evidenceIds?: unknown }).evidenceIds);
      if (!summary) return null;
      return { sourceAgent, summary, evidenceIds };
    })
    .filter((x): x is { sourceAgent: string; summary: string; evidenceIds: string[] } => x !== null);
}

function planHandoffs(args: {
  taskId: string;
  repository: string;
  baseBranch: string;
  proposedBranch: string;
  remediationGoals: string[];
  allEvidenceIds: string[];
}): CloudAgentHandoff[] {
  const {
    taskId,
    repository,
    baseBranch,
    proposedBranch,
    remediationGoals,
    allEvidenceIds,
  } = args;

  // Coding ships Grok API path; Testing verifies; Review reviews — never merge.
  return [
    {
      agentKind: "coding",
      handoffId: `handoff_coding_${taskId}`,
      status: "planned",
      prompt: [
        `Implement remediation for ${repository}.`,
        ...remediationGoals.map((g) => `- ${g}`),
        `Follow repo AGENTS.md, .cursor/rules/releasedesk-grok-api.mdc, and skill ship-grok-release-intel.`,
        `Prefer extending apps/releasedesk/src/lib/grok-release-intel.ts (classify + summarize + trustCheck).`,
        `Follow the implementation instructions prepared by Builder.`,
        `Commit on ${proposedBranch}.`,
        `Do NOT merge — human approval required.`,
      ].join("\n"),
      repository,
      baseBranch,
      proposedBranch,
      acceptanceCriteria: [
        "Changes compile / typecheck",
        "Unit tests added or updated for the fix",
        "Grok release-intel path present (MOCK without exclusive Lead key)",
        "No secrets introduced",
        "PR opened but not merged",
      ],
      relatedEvidenceIds: allEvidenceIds,
      metadata: {
        branch: proposedBranch,
        cloudAgentApi: "not_wired",
      },
    },
    {
      agentKind: "testing",
      handoffId: `handoff_testing_${taskId}`,
      status: "planned",
      prompt: [
        `Independently VERIFY remediation on ${proposedBranch} (Testing Cloud Agent).`,
        `Run npm test / desk+core suites and report failures with evidence.`,
        `Do NOT implement new product features; do NOT merge.`,
      ].join("\n"),
      repository,
      baseBranch,
      proposedBranch,
      acceptanceCriteria: [
        "All required test suites pass",
        "Failures attached as evidence",
        "No merge — human gate required",
      ],
      relatedEvidenceIds: allEvidenceIds,
      metadata: {
        branch: proposedBranch,
        testsPassed: undefined,
        cloudAgentApi: "not_wired",
      },
    },
    {
      agentKind: "review",
      handoffId: `handoff_review_${taskId}`,
      status: "planned",
      prompt: [
        `Independently REVIEW the remediation PR for ${repository} (Review Cloud Agent).`,
        `Check policy/security regressions and Grok intel trustCheck presence.`,
        `Do NOT approve merge; humans own merge/release gates.`,
      ].join("\n"),
      repository,
      baseBranch,
      proposedBranch,
      acceptanceCriteria: [
        "Review comments recorded",
        "No merge — human gate required",
      ],
      relatedEvidenceIds: allEvidenceIds,
      metadata: {
        branch: proposedBranch,
        prUrl: undefined,
        cloudAgentApi: "not_wired",
      },
    },
  ];
}

export function createBuilderRunner(options: SpecialistRunnerOptions = {}): AgentRunner {
  return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
    const input = inv.task.input ?? {};
    const repository =
      asString(input.repository) ?? inv.run.target.repository ?? "unknown/repo";
    const goals = asStringArray(input.remediationGoals);
    const remediationGoals =
      goals.length > 0 ? goals : ["Address specialist findings before release"];
    const baseBranch =
      asString(input.baseBranch) ?? inv.run.target.baseRef ?? "main";
    const related = parseRelatedFindings(input.relatedFindings);

    const mocksUsed: MockMeta[] = [];
    const evidence: CreateEvidenceInput[] = [];

    const branchSlug = slugify(remediationGoals[0] ?? "remediation") || "remediation";
    const proposedBranch = `cursor/rd-remediation-${branchSlug}-b5af`;

    const implementationInstructions = [
      `# Remediation implementation instructions`,
      ``,
      `Repository: ${repository}`,
      `Base branch: ${baseBranch}`,
      `Proposed branch: ${proposedBranch}`,
      ``,
      `## Goals`,
      ...remediationGoals.map((g, i) => `${i + 1}. ${g}`),
      ``,
      `## Related findings`,
      ...(related.length
        ? related.map((r) => `- [${r.sourceAgent}] ${r.summary}`)
        : ["- (none attached)"]),
      ``,
      `## Steps`,
      `1. Create branch \`${proposedBranch}\` from \`${baseBranch}\`.`,
      `2. Implement fixes addressing each goal with tests.`,
      `3. Run workspace tests (\`npm test\`) and record results.`,
      `4. Open a PR; do not merge without human approval (Release Desk gate).`,
      `5. Return branch name, test outcome, and PR URL to the Lead via Builder metadata.`,
    ].join("\n");

    const allEvidenceIds = related.flatMap((r) => r.evidenceIds);

    let handoffs = planHandoffs({
      taskId: inv.taskId,
      repository,
      baseBranch,
      proposedBranch,
      remediationGoals,
      allEvidenceIds,
    });

    evidence.push({
      kind: "artifact",
      title: "Implementation instructions",
      summary: `Prepared remediation instructions for ${remediationGoals.length} goal(s)`,
      source: "builder",
      data: { implementationInstructions, proposedBranch, baseBranch },
    });

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Refine remediation plan for ${repository}: ${remediationGoals.join("; ")}`,
        {
          ...options.grok,
          agentRole: options.grok?.agentRole ?? "builder",
          fallback: implementationInstructions,
        },
      );
      if (grok.mocked && grok.mock) mocksUsed.push(grok.mock);
      if (!grok.mocked) {
        evidence.push({
          kind: "artifact",
          title: "Grok remediation narrative",
          summary: grok.text.slice(0, 2000),
          source: "builder",
        });
      }
    }

    let proposedPrUrl: string | undefined;
    let testsPassed: boolean | undefined;
    let finalBranch = proposedBranch;
    let cloudAudit: unknown[] = [];
    let cloudAttempts: unknown[] = [];
    let clientMode: "mock" | "real" | "skipped" = "skipped";

    if (options.skipCloudDispatch) {
      const cloudMock = createMockMeta(
        "cursor-cloud-agents",
        "Cloud dispatch skipped (skipCloudDispatch); handoffs remain planned",
      );
      mocksUsed.push(cloudMock);
      evidence.push({
        kind: "artifact",
        title: "Cursor Cloud Agent handoffs (planned)",
        summary: formatMockNote(
          `Prepared ${handoffs.length} Cloud Agent handoff(s); dispatch skipped`,
        ),
        source: "builder",
        mock: cloudMock,
        data: { handoffs },
      });
    } else {
      const client = resolveCloudAgentClient({
        ...options.cloud,
        client: options.cloudClient ?? options.cloud?.client,
      });
      clientMode = client.mode;

      evidence.push({
        kind: "artifact",
        title: "Cursor Cloud Agent client",
        summary: describeCloudClientMode(client),
        source: "builder",
        mock:
          client.mode === "mock"
            ? createMockMeta(
                "cursor-cloud-agents",
                "Using MOCK Cloud Agent client — no live Cursor credentials required",
              )
            : undefined,
        data: { mode: client.mode, autoMerge: false },
      });

      const pipeline = await dispatchCloudAgentPipeline(handoffs, {
        client,
        maxAttempts: options.cloudMaxAttempts ?? 2,
      });

      handoffs = pipeline.handoffs;
      finalBranch = pipeline.proposedBranch;
      proposedPrUrl = pipeline.proposedPrUrl;
      testsPassed = pipeline.testsPassed;
      cloudAudit = pipeline.audit;
      cloudAttempts = pipeline.attempts;

      for (const result of pipeline.results) {
        if (result.mocked && result.mock) {
          if (!mocksUsed.some((m) => m.mockLabel === result.mock!.mockLabel && m.note === result.mock!.note)) {
            mocksUsed.push(result.mock);
          }
        }

        evidence.push({
          kind: result.prUrl ? "pr_ref" : "artifact",
          title: `${result.agentKind} Cloud Agent — ${result.status}`,
          summary: result.summary,
          source: "builder",
          uri: result.cloudAgentUrl ?? result.prUrl,
          mock: result.mock,
          data: {
            handoffId: result.handoffId,
            agentKind: result.agentKind,
            status: result.status,
            attempt: result.attempt,
            branch: result.branch,
            prUrl: result.prUrl,
            testsPassed: result.testsPassed,
            cloudAgentId: result.cloudAgentId,
            cloudRunId: result.cloudRunId,
            autoMerge: false,
            error: result.error,
            provider: result.provider,
          },
        });
      }

      evidence.push({
        kind: "artifact",
        title: "Cloud Agent dispatch audit trail",
        summary: `Recorded ${pipeline.audit.length} Cloud Agent audit event(s)`,
        source: "builder",
        data: {
          audit: pipeline.audit,
          attempts: pipeline.attempts,
          autoMerge: false,
          humanMergeGateRequired: true,
        },
      });

      if (client.mode === "mock" && !mocksUsed.some((m) => m.mockLabel === "cursor-cloud-agents")) {
        mocksUsed.push(
          createMockMeta(
            "cursor-cloud-agents",
            "MOCK Cloud Agent client used for Coding/Testing/Review dispatch",
          ),
        );
      }
    }

    const workItems = handoffs.map((h) => ({
      kind: h.agentKind,
      status: h.status === "planned" ? ("planned" as const) : h.status,
      branch: h.metadata.branch ?? finalBranch,
      ...(h.metadata.prUrl ? { prUrl: h.metadata.prUrl } : {}),
      notes:
        h.status === "planned"
          ? formatMockNote(`${h.agentKind} Cloud Agent handoff ${h.handoffId} planned`)
          : h.metadata.error
            ? `${h.agentKind} ${h.status}: ${h.metadata.error}`
            : `${h.agentKind} ${h.status} on ${h.metadata.branch ?? finalBranch}` +
              (typeof h.metadata.testsPassed === "boolean"
                ? `; testsPassed=${h.metadata.testsPassed}`
                : "") +
              (h.metadata.prUrl ? `; pr=${h.metadata.prUrl}` : "") +
              "; merge requires human approval",
    }));

    const dispatched = !options.skipCloudDispatch;
    const anyFailed = handoffs.some((h) => h.status === "failed");
    const summaryBase = dispatched
      ? `Builder dispatched Coding→Testing/Review on ${finalBranch}` +
        (proposedPrUrl ? `; PR ${proposedPrUrl}` : "") +
        (typeof testsPassed === "boolean" ? `; testsPassed=${testsPassed}` : "") +
        `; client=${clientMode}; human merge gate required`
      : `Builder remediation planned on ${finalBranch}; Cloud dispatch skipped`;

    const summary =
      clientMode === "mock" || options.skipCloudDispatch
        ? formatMockNote(summaryBase)
        : summaryBase;

    const payload = BuilderAgentOutputSchema.parse({
      runId: inv.runId,
      taskId: inv.taskId,
      agentRole: "builder",
      status: "completed",
      completedAt: nowIso(),
      summary,
      evidence: [],
      mocksUsed,
      workItems,
      proposedBranch: finalBranch,
      ...(proposedPrUrl ? { proposedPrUrl } : {}),
      ...(typeof testsPassed === "boolean" ? { testsPassed } : {}),
    });

    return {
      status: anyFailed && dispatched ? "completed" : "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        workItems: payload.workItems,
        proposedBranch: payload.proposedBranch,
        proposedPrUrl: payload.proposedPrUrl,
        testsPassed: payload.testsPassed,
        implementationInstructions,
        cloudAgentHandoffs: handoffs,
        cloudAgentAudit: cloudAudit,
        cloudAgentAttempts: cloudAttempts,
        cloudClientMode: clientMode,
        /** Explicit metadata fields tracked for Lead / M6. */
        branchMetadata: {
          proposedBranch: finalBranch,
          baseBranch,
          testsPassed,
          prUrl: proposedPrUrl,
          autoMerge: false,
          humanMergeGateRequired: true,
        },
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
