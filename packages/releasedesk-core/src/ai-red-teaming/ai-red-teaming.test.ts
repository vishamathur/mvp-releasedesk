import { describe, expect, it } from "vitest";
import { MissingCredentialError } from "../config-error.js";
import {
  AI_RED_TEAM_PROVIDER_ENV,
  createGrokGuardrailsProvider,
  DEFAULT_AI_RED_TEAM_PROVIDER,
  evaluateIterationProceedGate,
  isNonBlockingRemediation,
  parseAiRedTeamProviderName,
  resolveAiRedTeamingProvider,
  runCollapsedAiRedTeamGate,
  type IterationApproval,
} from "./index.js";

const target = {
  repository: "vishamathur/mvp-releasedesk",
  appLabel: "northwind-kyc",
};
const frameworks = ["atlas", "owasp_llm_top_10"] as const;

describe("parseAiRedTeamProviderName", () => {
  it("defaults to grok-guardrails when unset or empty", () => {
    expect(parseAiRedTeamProviderName(undefined)).toBe("grok-guardrails");
    expect(parseAiRedTeamProviderName("")).toBe("grok-guardrails");
    expect(parseAiRedTeamProviderName("GROK-GUARDRAILS")).toBe("grok-guardrails");
    expect(DEFAULT_AI_RED_TEAM_PROVIDER).toBe("grok-guardrails");
  });

  it("rejects any other provider name", () => {
    expect(() => parseAiRedTeamProviderName("custom")).toThrow(/only provider is grok-guardrails/);
    expect(() => parseAiRedTeamProviderName("zscaler")).toThrow(/only provider is grok-guardrails/);
    expect(() => parseAiRedTeamProviderName("splx")).toThrow(/only provider is grok-guardrails/);
  });
});

describe("resolveAiRedTeamingProvider factory", () => {
  it("selects grok-guardrails when unset", () => {
    const provider = resolveAiRedTeamingProvider({ env: {} });
    expect(provider.name).toBe("grok-guardrails");
  });

  it(`selects grok-guardrails when ${AI_RED_TEAM_PROVIDER_ENV}=grok-guardrails`, () => {
    const provider = resolveAiRedTeamingProvider({
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "grok-guardrails" },
    });
    expect(provider.name).toBe("grok-guardrails");
  });

  it("throws when the env names another provider", () => {
    expect(() =>
      resolveAiRedTeamingProvider({
        env: { [AI_RED_TEAM_PROVIDER_ENV]: "custom" },
      }),
    ).toThrow(/only provider is grok-guardrails/);
  });
});

describe("grok-guardrails provider", () => {
  it("throws a configuration error when the Security key is missing", async () => {
    const provider = createGrokGuardrailsProvider({ env: {}, apiKey: "" });
    await expect(provider.healthCheck()).rejects.toBeInstanceOf(MissingCredentialError);
    await expect(provider.runProbes(target, frameworks)).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
  });
});

describe("collapsed gate + side-queue remediation + iteration approval", () => {
  const nowIso = "2026-11-17T08:00:00.000Z";
  const blockingFinding = {
    id: "f-block-1",
    severity: "high" as const,
    title: "MOCK: blocking probe",
    summary: "MOCK: release-blocking finding",
    atlas: ["AML.T0051"],
    owasp: ["LLM01"],
    releaseBlocking: true,
    mocked: true,
  };

  it("hard-blocks iteration without red_team or security approval", () => {
    const gate = evaluateIterationProceedGate({
      iterationId: "iter_1",
      approvals: [],
    });
    expect(gate.mandatoryApproval).toBe(true);
    expect(gate.canProceed).toBe(false);
    expect(gate.satisfied).toBe(false);
    expect(gate.blockingIssue).toMatch(/red_team approval or security approval/);
  });

  it("allows proceed with red_team approval alone", () => {
    const approvals: IterationApproval[] = [
      {
        iterationId: "iter_1",
        kind: "red_team",
        approvedBy: "red-team-reviewer",
        approvedAt: nowIso,
      },
    ];
    const gate = evaluateIterationProceedGate({ iterationId: "iter_1", approvals });
    expect(gate.hasRedTeamApproval).toBe(true);
    expect(gate.hasSecurityApproval).toBe(false);
    expect(gate.canProceed).toBe(true);
  });

  it("allows proceed with security approval alone", () => {
    const approvals: IterationApproval[] = [
      {
        iterationId: "iter_2",
        kind: "security",
        approvedBy: "sec-reviewer",
        approvedAt: nowIso,
      },
    ];
    const gate = evaluateIterationProceedGate({ iterationId: "iter_2", approvals });
    expect(gate.hasSecurityApproval).toBe(true);
    expect(gate.canProceed).toBe(true);
  });

  it("runs both phases in one collapsed pass and keeps remediation off the main path", () => {
    const result = runCollapsedAiRedTeamGate({
      iterationId: "iter_3",
      nowIso,
      createSideQueueId: () => "sideq_test_1",
      context: {
        provider: "grok-guardrails",
        mcpContext: "grok-guardrails",
        findingsRouting: "block",
      },
      preReleaseFindings: [blockingFinding],
      postRemediationFindings: [],
      approvals: [
        {
          iterationId: "iter_3",
          kind: "red_team",
          approvedBy: "rt",
          approvedAt: nowIso,
        },
      ],
    });

    expect(result.stage).toBe("collapsed_gate");
    expect(result.phases.pre_release.phase).toBe("pre_release");
    expect(result.phases.post_remediation.phase).toBe("post_remediation");
    expect(result.context.mcpContext).toBe("grok-guardrails");
    expect(result.remediationSideQueue).toHaveLength(1);
    expect(result.remediationSideQueue[0]?.nonBlocking).toBe(true);
    expect(isNonBlockingRemediation(result.remediationSideQueue[0]!)).toBe(true);
    expect(result.iterationProceed.canProceed).toBe(true);
    expect(result.nextMainStage).toBe("human_merge_release");
  });

  it("holds main flow on collapsed_gate when iteration lacks approval even if side-queue enqueues", () => {
    const result = runCollapsedAiRedTeamGate({
      iterationId: "iter_4",
      nowIso,
      createSideQueueId: () => "sideq_test_2",
      context: {
        provider: "grok-guardrails",
        findingsRouting: "warn",
      },
      preReleaseFindings: [blockingFinding],
      postRemediationFindings: [blockingFinding],
      approvals: [],
    });

    expect(result.remediationSideQueue.length).toBe(1);
    expect(result.iterationProceed.canProceed).toBe(false);
    expect(result.nextMainStage).toBe("collapsed_gate");
    expect(result.releaseBlockingCount).toBe(2);
  });

  it("does not enqueue side-queue for report-only routing", () => {
    const result = runCollapsedAiRedTeamGate({
      iterationId: "iter_5",
      nowIso,
      context: { provider: "grok-guardrails", findingsRouting: "report-only" },
      preReleaseFindings: [blockingFinding],
      postRemediationFindings: [],
      approvals: [
        {
          iterationId: "iter_5",
          kind: "security",
          approvedBy: "sec",
          approvedAt: nowIso,
        },
      ],
    });
    expect(result.remediationSideQueue).toHaveLength(0);
    expect(result.nextMainStage).toBe("human_merge_release");
  });
});
