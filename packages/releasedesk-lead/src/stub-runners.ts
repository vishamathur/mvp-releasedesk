import {
  createEvidenceItem,
  createMockMeta,
  formatMockNote,
  nowIso,
  type CreateEvidenceInput,
} from "@releasedesk/core";
import type { AgentRunner, AgentRunInvocation, AgentRunResult, SpecialistRole } from "./agent-runner.js";

/**
 * Thin MOCK specialists for Milestone 3.
 * They return fixture-shaped outputs labeled `MOCK:` so the Lead can exercise
 * real task recording, evidence, and readiness consolidation before M4 agents land.
 */

function mockEvidence(
  title: string,
  summary: string,
  source: SpecialistRole,
  kind: CreateEvidenceInput["kind"] = "finding",
  mockLabel = "specialist-stub",
): CreateEvidenceItem {
  return {
    kind,
    title,
    summary: formatMockNote(summary),
    source,
    mock: createMockMeta(mockLabel, summary),
  };
}

type CreateEvidenceItem = CreateEvidenceInput;

export const stubChangeAnalystRunner: AgentRunner = async (
  inv: AgentRunInvocation,
): Promise<AgentRunResult> => {
  const mock = createMockMeta("change-analyst-stub", "Fixture change analysis; no GitHub API call");
  const evidence = [
    mockEvidence(
      "Change summary (stub)",
      "Reviewed head vs base with stub commit list",
      "change_analyst",
      "diff",
      "change-analyst-stub",
    ),
  ];
  return {
    status: "completed",
    summary: formatMockNote("Change analysis complete (stub)"),
    payload: {
      agentRole: "change_analyst",
      releaseNotesDraft: formatMockNote(
        "Stub release notes: KYC demo + shared contracts; no real git history inspected.",
      ),
      findings: [
        {
          path: "apps/kyc",
          changeType: "modified",
          impact: "low",
          summary: formatMockNote("KYC app paths touched (stub)"),
        },
      ],
      overallImpact: "low",
      commitsReviewed: 0,
      evidence: evidence.map((e) => createEvidenceItem(e)),
      mocksUsed: [mock],
    },
    evidence,
    mocksUsed: [mock],
  };
};

export const stubStandardsRunner: AgentRunner = async (
  inv: AgentRunInvocation,
): Promise<AgentRunResult> => {
  const mock = createMockMeta("standards-stub", "Fixture standards check; no policy corpus loaded");
  const evidence = [
    mockEvidence(
      "Policy check (stub)",
      "Northwind KYC standards evaluated against fixture corpus",
      "standards",
      "policy_ref",
      "standards-stub",
    ),
  ];
  return {
    status: "completed",
    summary: formatMockNote("Standards check complete (stub) — compliant"),
    payload: {
      agentRole: "standards",
      compliant: true,
      deviations: [],
      policiesChecked: ["MOCK:northwind-kyc-baseline"],
      evidence: evidence.map((e) => createEvidenceItem(e)),
      mocksUsed: [mock],
    },
    evidence,
    mocksUsed: [mock],
  };
};

export const stubSecurityRunner: AgentRunner = async (
  inv: AgentRunInvocation,
): Promise<AgentRunResult> => {
  const mock = createMockMeta("security-stub", "Fixture security scan; no NVD/advisory API");
  const evidence = [
    mockEvidence(
      "Security scan (stub)",
      "No release-blocking advisories in fixture scan",
      "security",
      "advisory",
      "security-stub",
    ),
  ];
  return {
    status: "completed",
    summary: formatMockNote("Security check complete (stub) — risk none"),
    payload: {
      agentRole: "security",
      findings: [],
      releaseBlockingCount: 0,
      riskLevel: "none",
      evidence: evidence.map((e) => createEvidenceItem(e)),
      mocksUsed: [mock],
    },
    evidence,
    mocksUsed: [mock],
  };
};

export const stubBuilderRunner: AgentRunner = async (
  inv: AgentRunInvocation,
): Promise<AgentRunResult> => {
  const goals = (inv.task.input?.remediationGoals as string[] | undefined) ?? [
    "Address specialist findings",
  ];
  const mock = createMockMeta(
    "builder-stub",
    "Fixture remediation; Cursor Cloud Agents not wired (M5)",
  );
  const evidence = [
    mockEvidence(
      "Remediation plan (stub)",
      `Planned work for: ${goals.join("; ")}`,
      "builder",
      "artifact",
      "builder-stub",
    ),
  ];
  return {
    status: "completed",
    summary: formatMockNote("Builder remediation planned (stub); no Cursor Cloud dispatch"),
    payload: {
      agentRole: "builder",
      workItems: [
        {
          kind: "coding",
          status: "planned",
          notes: formatMockNote("Coding agent not dispatched (M5)"),
        },
        {
          kind: "testing",
          status: "planned",
          notes: formatMockNote("Testing agent not dispatched (M5)"),
        },
      ],
      proposedBranch: "MOCK:cursor/stub-remediation",
      testsPassed: undefined,
      evidence: evidence.map((e) => createEvidenceItem(e)),
      mocksUsed: [mock],
    },
    evidence,
    mocksUsed: [mock],
  };
};

export function createDefaultStubRunners(): Record<SpecialistRole, AgentRunner> {
  return {
    change_analyst: stubChangeAnalystRunner,
    standards: stubStandardsRunner,
    security: stubSecurityRunner,
    builder: stubBuilderRunner,
  };
}

/** Optional failing runner for retry/failure tests. */
export function createFlakyRunner(opts: {
  failAttempts: number;
  failureCode?: string;
  retryable?: boolean;
}): AgentRunner {
  let calls = 0;
  return async (inv): Promise<AgentRunResult> => {
    calls += 1;
    if (calls <= opts.failAttempts) {
      return {
        status: "failed",
        summary: formatMockNote(`Injected failure attempt ${calls}`),
        payload: { agentRole: inv.agentRole },
        failure: {
          code: opts.failureCode ?? "stub_injected_failure",
          message: formatMockNote(`Injected failure on attempt ${calls}`),
          retryable: opts.retryable ?? true,
          failedAt: nowIso(),
        },
        mocksUsed: [createMockMeta("flaky-stub", "Injected failure for retry tests")],
      };
    }
    const stubs = createDefaultStubRunners();
    return stubs[inv.agentRole](inv);
  };
}
