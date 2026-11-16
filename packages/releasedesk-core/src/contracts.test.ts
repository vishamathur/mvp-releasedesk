import { describe, expect, it } from "vitest";
import {
  AiRedTeamingAgentInputSchema,
  AiRedTeamingAgentOutputSchema,
  BuilderAgentInputSchema,
  BuilderAgentOutputSchema,
  ChangeAnalystInputSchema,
  ChangeAnalystOutputSchema,
  LeadAgentInputSchema,
  LeadAgentOutputSchema,
  SecurityAgentInputSchema,
  SecurityAgentOutputSchema,
  StandardsAgentInputSchema,
  StandardsAgentOutputSchema,
} from "./agents/index.js";
import { createEvidenceItem } from "./evidence.js";
import { createRunId, createTaskId } from "./ids.js";
import { createMockMeta, formatMockNote, isMockNote, MOCK_NOTE_PREFIX } from "./mock.js";
import { createTaskRecord, listReadyTasks } from "./task.js";

const runId = createRunId();
const taskId = createTaskId();
const invokedAt = new Date().toISOString();
const completedAt = new Date().toISOString();

describe("mock labeling convention", () => {
  it("prefixes notes with MOCK:", () => {
    expect(formatMockNote("fabricated advisory")).toBe(`${MOCK_NOTE_PREFIX} fabricated advisory`);
    expect(isMockNote(formatMockNote("x"))).toBe(true);
    expect(createMockMeta("nvd", "local stub").note).toMatch(/^MOCK:/);
  });
});

describe("agent contract schemas", () => {
  it("parses Lead input/output", () => {
    const input = LeadAgentInputSchema.parse({
      runId,
      taskId,
      agentRole: "lead",
      invokedAt,
      attempt: 0,
      goal: "Release readiness for Northwind KYC",
      target: { repository: "vishamathur/mvp-releasedesk", baseRef: "main" },
      trigger: { kind: "on_demand", requestedBy: "operator" },
    });
    expect(input.agentRole).toBe("lead");

    const output = LeadAgentOutputSchema.parse({
      runId,
      taskId,
      agentRole: "lead",
      status: "completed",
      completedAt,
      summary: "Delegated analysts; awaiting results",
      evidence: [],
      mocksUsed: [],
      readiness: "unknown",
      delegations: [
        {
          taskId: createTaskId(),
          agentRole: "change_analyst",
          rationale: "Need change impact first",
        },
      ],
      blockingIssues: [],
      remediationRecommended: false,
    });
    expect(output.delegations).toHaveLength(1);
  });

  it("parses Change Analyst input/output", () => {
    const input = ChangeAnalystInputSchema.parse({
      runId,
      taskId,
      agentRole: "change_analyst",
      invokedAt,
      repository: "vishamathur/mvp-releasedesk",
      baseRef: "main",
      headRef: "cursor/feature-8f1e",
      focusPaths: ["apps/kyc"],
    });
    expect(input.focusPaths).toEqual(["apps/kyc"]);

    const output = ChangeAnalystOutputSchema.parse({
      runId,
      taskId,
      agentRole: "change_analyst",
      status: "completed",
      completedAt,
      summary: "Two files changed in KYC risk scoring",
      evidence: [
        createEvidenceItem({
          kind: "diff",
          title: "risk.ts diff",
          summary: "Adjusted PEP scoring weights",
          source: "change_analyst",
          mock: createMockMeta("github-api", "diff synthesized for fixture"),
        }),
      ],
      mocksUsed: [createMockMeta("github-api")],
      releaseNotesDraft: "- Adjust PEP scoring weights",
      findings: [
        {
          path: "apps/kyc/src/lib/domain/risk.ts",
          changeType: "modified",
          impact: "medium",
          summary: "Risk score weights changed",
        },
      ],
      overallImpact: "medium",
      commitsReviewed: 3,
    });
    expect(output.findings[0]?.impact).toBe("medium");
    expect(output.evidence[0]?.mock?.mocked).toBe(true);
  });

  it("parses Standards input/output", () => {
    StandardsAgentInputSchema.parse({
      runId,
      taskId,
      agentRole: "standards",
      invokedAt,
      repository: "vishamathur/mvp-releasedesk",
      policyRefs: ["northwind/kyc-doc-requirements"],
    });

    const output = StandardsAgentOutputSchema.parse({
      runId,
      taskId,
      agentRole: "standards",
      status: "completed",
      completedAt,
      summary: "One deviation against document retention policy",
      evidence: [],
      mocksUsed: [],
      compliant: false,
      deviations: [
        {
          policyRef: "northwind/kyc-doc-requirements",
          severity: "medium",
          summary: "Missing retention label on mock uploads",
        },
      ],
      policiesChecked: ["northwind/kyc-doc-requirements"],
    });
    expect(output.compliant).toBe(false);
  });

  it("parses Security input/output", () => {
    SecurityAgentInputSchema.parse({
      runId,
      taskId,
      agentRole: "security",
      invokedAt,
      repository: "vishamathur/mvp-releasedesk",
      components: [{ name: "next", version: "16.4.6", ecosystem: "npm" }],
    });

    const output = SecurityAgentOutputSchema.parse({
      runId,
      taskId,
      agentRole: "security",
      status: "completed",
      completedAt,
      summary: "No release-blocking advisories",
      evidence: [],
      mocksUsed: [createMockMeta("nvd", "advisory lookup stubbed")],
      findings: [],
      releaseBlockingCount: 0,
      riskLevel: "none",
    });
    expect(output.riskLevel).toBe("none");
  });

  it("parses Builder input/output", () => {
    BuilderAgentInputSchema.parse({
      runId,
      taskId,
      agentRole: "builder",
      invokedAt,
      repository: "vishamathur/mvp-releasedesk",
      remediationGoals: ["Add retention label to mock uploads"],
      baseBranch: "main",
      relatedFindings: [
        {
          sourceAgent: "standards",
          summary: "Missing retention label",
          evidenceIds: [],
        },
      ],
    });

    const output = BuilderAgentOutputSchema.parse({
      runId,
      taskId,
      agentRole: "builder",
      status: "completed",
      completedAt,
      summary: "Prepared coding work item (not dispatched)",
      evidence: [],
      mocksUsed: [],
      workItems: [{ kind: "coding", status: "planned", branch: "cursor/fix-retention-8f1e" }],
      proposedBranch: "cursor/fix-retention-8f1e",
    });
    expect(output.workItems[0]?.kind).toBe("coding");
  });

  it("parses AI Red Teaming input/output", () => {
    AiRedTeamingAgentInputSchema.parse({
      runId,
      taskId,
      agentRole: "ai_red_teaming",
      invokedAt,
      repository: "vishamathur/mvp-releasedesk",
      touchpoint: "cloud_coding",
      passKind: "guardrail",
      subjectText: "Implement remediation without leaking prompts",
      subjectMeta: { sourceAgent: "builder", reviewReady: false },
    });

    const output = AiRedTeamingAgentOutputSchema.parse({
      runId,
      taskId,
      agentRole: "ai_red_teaming",
      status: "completed",
      completedAt,
      summary: "AI Red Teaming guardrail clean",
      evidence: [],
      mocksUsed: [],
      touchpoint: "cloud_coding",
      passKind: "guardrail",
      findings: [],
      releaseBlockingCount: 0,
      riskLevel: "none",
      frameworksApplied: ["mitre_atlas", "owasp_llm"],
      flagLeadRealtime: false,
      hardBlockRecommended: false,
    });
    expect(output.agentRole).toBe("ai_red_teaming");
    expect(output.frameworksApplied).toContain("mitre_atlas");
  });

  it("rejects mismatched agentRole on Lead output", () => {
    expect(() =>
      LeadAgentOutputSchema.parse({
        runId,
        taskId,
        agentRole: "security",
        status: "completed",
        completedAt,
        summary: "nope",
        evidence: [],
        mocksUsed: [],
        readiness: "ready",
        delegations: [],
        blockingIssues: [],
        remediationRecommended: false,
      }),
    ).toThrow();
  });
});

describe("parallel-safe task model", () => {
  it("lists ready tasks and respects dependencies", () => {
    const a = createTaskRecord({
      runId,
      name: "change analysis",
      agentRole: "change_analyst",
    });
    const b = createTaskRecord({
      runId,
      name: "standards check",
      agentRole: "standards",
      dependsOn: [a.id],
    });
    const c = createTaskRecord({
      runId,
      name: "security check",
      agentRole: "security",
    });

    expect(listReadyTasks([a, b, c]).map((t) => t.id).sort()).toEqual([a.id, c.id].sort());

    const aDone = { ...a, status: "completed" as const };
    expect(listReadyTasks([aDone, b, c]).map((t) => t.name).sort()).toEqual(
      ["security check", "standards check"],
    );
  });
});
