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

export const stubAiRedTeamingRunner: AgentRunner = async (
  inv: AgentRunInvocation,
): Promise<AgentRunResult> => {
  const touchpoint =
    (inv.task.input?.touchpoint as string | undefined) ?? "sdlc_ai_prompt";
  const passKind =
    (inv.task.input?.passKind as string | undefined) ?? "guardrail";
  const inject = Array.isArray(inv.task.input?.injectFindings)
    ? (inv.task.input?.injectFindings as Array<Record<string, unknown>>)
    : [];
  const findings = inject.map((f, i) => ({
    id: String(f.id ?? `stub_ai_rt_${i + 1}`),
    severity: (f.severity as string) ?? "medium",
    title: String(f.title ?? "Stub AI Red Teaming finding"),
    summary: String(f.summary ?? "Injected stub finding"),
    framework: (f.framework as string) ?? "both",
    category: (f.category as string) ?? "other",
    releaseBlocking: Boolean(f.releaseBlocking),
    touchpoint,
    ...(typeof f.atlasTechnique === "string"
      ? { atlasTechnique: f.atlasTechnique }
      : {}),
    ...(typeof f.owaspLlmId === "string" ? { owaspLlmId: f.owaspLlmId } : {}),
  }));
  const releaseBlockingCount = findings.filter((f) => f.releaseBlocking).length;
  const flagLeadRealtime = releaseBlockingCount > 0;
  const subjectMeta =
    inv.task.input?.subjectMeta && typeof inv.task.input.subjectMeta === "object"
      ? (inv.task.input.subjectMeta as { prDraft?: boolean; reviewReady?: boolean })
      : {};
  const prDraft = subjectMeta.prDraft === true;
  const reviewReady =
    subjectMeta.reviewReady === true || (!prDraft && passKind === "hard_block");
  const hardBlockRecommended =
    passKind === "hard_block" && releaseBlockingCount > 0 && reviewReady && !prDraft;
  const mock = createMockMeta(
    "ai-red-teaming-stub",
    "Fixture AI Red Teaming pass; no live ATLAS/OWASP API",
  );
  const evidence = [
    mockEvidence(
      "AI Red Teaming (stub)",
      findings.length === 0
        ? `Clean ${passKind} pass @ ${touchpoint}`
        : `${findings.length} finding(s) @ ${touchpoint}`,
      "ai_red_teaming",
      "finding",
      "ai-red-teaming-stub",
    ),
  ];
  return {
    status: "completed",
    summary: formatMockNote(
      findings.length === 0
        ? `AI Red Teaming ${passKind} complete (stub) — clean`
        : `AI Red Teaming ${passKind} complete (stub) — ${releaseBlockingCount} blocking; flagLead=${flagLeadRealtime}`,
    ),
    payload: {
      agentRole: "ai_red_teaming",
      touchpoint,
      passKind,
      findings,
      releaseBlockingCount,
      riskLevel: releaseBlockingCount > 0 ? "high" : "none",
      frameworksApplied: ["mitre_atlas", "owasp_llm"],
      flagLeadRealtime,
      hardBlockRecommended,
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
  const cycle = (inv.task.input?.remediationCycle as number | undefined) ?? 1;
  const mock = createMockMeta(
    "builder-stub",
    "Fixture remediation with MOCK PR metadata (M6)",
  );
  const proposedBranch = `MOCK:cursor/stub-remediation-c${cycle}`;
  const proposedPrUrl = `https://github.com/vishamathur/mvp-releasedesk/pull/${8000 + cycle}`;
  const evidence = [
    mockEvidence(
      "Remediation plan (stub)",
      `Planned work for: ${goals.join("; ")}`,
      "builder",
      "artifact",
      "builder-stub",
    ),
    {
      kind: "pr_ref" as const,
      title: "MOCK proposed PR",
      summary: formatMockNote(`Stub PR ${proposedPrUrl}`),
      source: "builder" as const,
      uri: proposedPrUrl,
      mock: createMockMeta("github-pr", "Stub Builder PR URL"),
    },
  ];
  return {
    status: "completed",
    summary: formatMockNote(
      `Builder remediation complete (stub); testsPassed=true; PR ${proposedPrUrl}`,
    ),
    payload: {
      agentRole: "builder",
      workItems: [
        {
          kind: "coding",
          status: "completed",
          branch: proposedBranch,
          prUrl: proposedPrUrl,
          notes: formatMockNote("Coding stub completed"),
        },
        {
          kind: "testing",
          status: "completed",
          branch: proposedBranch,
          notes: formatMockNote("Testing stub completed; testsPassed=true"),
        },
        {
          kind: "review",
          status: "completed",
          branch: proposedBranch,
          notes: formatMockNote("Review stub completed"),
        },
      ],
      proposedBranch,
      proposedPrUrl,
      testsPassed: true,
      branchMetadata: {
        proposedBranch,
        baseBranch: "main",
        testsPassed: true,
        prUrl: proposedPrUrl,
        autoMerge: false,
        humanMergeGateRequired: true,
      },
      evidence: evidence.map((e) => createEvidenceItem(e)),
      mocksUsed: [mock],
    },
    evidence,
    mocksUsed: [mock],
  };
};

/** Default stub specialist set — Security + AI Red Teaming included. */
export function createDefaultStubRunners(): Record<SpecialistRole, AgentRunner> {
  const runners: Record<SpecialistRole, AgentRunner> = {
    change_analyst: stubChangeAnalystRunner,
    standards: stubStandardsRunner,
    security: stubSecurityRunner,
    builder: stubBuilderRunner,
    ai_red_teaming: stubAiRedTeamingRunner,
  };
  if (!runners.security) {
    throw new Error("Security stub runner missing — mandatory on every change");
  }
  if (!runners.ai_red_teaming) {
    throw new Error("AI Red Teaming stub runner missing");
  }
  return runners;
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
