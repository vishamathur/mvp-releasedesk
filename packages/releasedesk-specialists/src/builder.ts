import {
  createMockMeta,
  formatMockNote,
  nowIso,
  BuilderAgentOutputSchema,
  type CreateEvidenceInput,
  type MockMeta,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult } from "@releasedesk/lead";
import { grokComplete } from "./grok.js";
import type { SpecialistRunnerOptions } from "./options.js";

/**
 * Cursor Cloud Agent handoff shape prepared by Builder (M4).
 * Full API dispatch is Milestone 5 — work items stay `planned`.
 */
export type CloudAgentHandoff = {
  agentKind: "coding" | "testing" | "review";
  /** Stable handoff id for M5 dispatch correlation. */
  handoffId: string;
  status: "planned";
  prompt: string;
  repository: string;
  baseBranch: string;
  proposedBranch: string;
  acceptanceCriteria: string[];
  relatedEvidenceIds: string[];
  metadata: {
    branch: string;
    testsPassed?: boolean;
    prUrl?: string;
    cloudAgentApi: "not_wired";
  };
};

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
    const proposedBranch = `cursor/rd-remediation-${branchSlug}-124e`;

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

    const handoffs: CloudAgentHandoff[] = [
      {
        agentKind: "coding",
        handoffId: `handoff_coding_${inv.taskId}`,
        status: "planned",
        prompt: [
          `Implement remediation for ${repository}.`,
          ...remediationGoals.map((g) => `- ${g}`),
          `Follow the implementation instructions prepared by Builder.`,
          `Commit on ${proposedBranch}.`,
        ].join("\n"),
        repository,
        baseBranch,
        proposedBranch,
        acceptanceCriteria: [
          "Changes compile / typecheck",
          "Unit tests added or updated for the fix",
          "No secrets introduced",
        ],
        relatedEvidenceIds: allEvidenceIds,
        metadata: {
          branch: proposedBranch,
          cloudAgentApi: "not_wired",
        },
      },
      {
        agentKind: "testing",
        handoffId: `handoff_testing_${inv.taskId}`,
        status: "planned",
        prompt: [
          `Independently verify remediation on ${proposedBranch}.`,
          `Run npm test and report failures with evidence.`,
        ].join("\n"),
        repository,
        baseBranch,
        proposedBranch,
        acceptanceCriteria: ["All required test suites pass", "Failures attached as evidence"],
        relatedEvidenceIds: allEvidenceIds,
        metadata: {
          branch: proposedBranch,
          testsPassed: undefined,
          cloudAgentApi: "not_wired",
        },
      },
      {
        agentKind: "review",
        handoffId: `handoff_review_${inv.taskId}`,
        status: "planned",
        prompt: [
          `Independently review the remediation PR for ${repository}.`,
          `Check policy/security regressions; do not approve merge.`,
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

    const cloudMock = createMockMeta(
      "cursor-cloud-agents",
      "Cursor Cloud Agent API not wired (Milestone 5); handoffs remain planned",
    );
    mocksUsed.push(cloudMock);

    evidence.push({
      kind: "artifact",
      title: "Implementation instructions",
      summary: `Prepared remediation instructions for ${remediationGoals.length} goal(s)`,
      source: "builder",
      data: { implementationInstructions, proposedBranch, baseBranch },
    });

    evidence.push({
      kind: "artifact",
      title: "Cursor Cloud Agent handoffs (planned)",
      summary: formatMockNote(
        `Prepared ${handoffs.length} Cloud Agent handoff shape(s); dispatch deferred to M5`,
      ),
      source: "builder",
      mock: cloudMock,
      data: { handoffs },
    });

    if (!options.skipGrok) {
      const grok = await grokComplete(
        `Refine remediation plan for ${repository}: ${remediationGoals.join("; ")}`,
        {
          ...options.grok,
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

    const workItems = handoffs.map((h) => ({
      kind: h.agentKind,
      status: "planned" as const,
      branch: h.proposedBranch,
      notes: formatMockNote(
        `${h.agentKind} Cloud Agent handoff ${h.handoffId} prepared; API not wired (M5)`,
      ),
    }));

    const summary = formatMockNote(
      `Builder remediation planned on ${proposedBranch}; ${workItems.length} Cloud Agent handoff(s) ready for M5`,
    );

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
      proposedBranch,
      // proposedPrUrl / testsPassed intentionally omitted until M5/M6 fill them.
    });

    return {
      status: "completed",
      summary: payload.summary,
      payload: {
        agentRole: payload.agentRole,
        workItems: payload.workItems,
        proposedBranch: payload.proposedBranch,
        implementationInstructions,
        cloudAgentHandoffs: handoffs,
        /** Explicit metadata fields tracked for M5/M6. */
        branchMetadata: {
          proposedBranch,
          baseBranch,
          testsPassed: undefined,
          prUrl: undefined,
        },
        evidence: payload.evidence,
        mocksUsed: payload.mocksUsed,
      },
      evidence,
      mocksUsed,
    };
  };
}
