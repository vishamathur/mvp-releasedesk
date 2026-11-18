import { describe, expect, it } from "vitest";
import { isMockNote } from "../mock.js";
import {
  AI_RED_TEAM_PROVIDER_ENV,
  createCustomAiRedTeamingProvider,
  createZscalerAiRedTeamingProvider,
  DEFAULT_AI_RED_TEAM_PROVIDER,
  evaluateIterationProceedGate,
  isNonBlockingRemediation,
  parseAiRedTeamProviderName,
  resolveAiRedTeamingProvider,
  resolveZscalerLocalConfig,
  runCollapsedAiRedTeamGate,
  ZSCALER_NOT_WIRED_CODE,
  ZscalerAiRedTeamNotWiredError,
  type IterationApproval,
} from "./index.js";

const target = {
  repository: "vishamathur/mvp-releasedesk",
  appLabel: "northwind-kyc",
};
const frameworks = ["atlas", "owasp_llm_top_10"] as const;

describe("parseAiRedTeamProviderName", () => {
  it("defaults to custom when unset/empty/unknown", () => {
    expect(parseAiRedTeamProviderName(undefined)).toBe("custom");
    expect(parseAiRedTeamProviderName("")).toBe("custom");
    expect(parseAiRedTeamProviderName("splx")).toBe("custom");
    expect(DEFAULT_AI_RED_TEAM_PROVIDER).toBe("custom");
  });

  it("accepts custom and zscaler (case-insensitive)", () => {
    expect(parseAiRedTeamProviderName("custom")).toBe("custom");
    expect(parseAiRedTeamProviderName("ZSCALER")).toBe("zscaler");
  });
});

describe("resolveAiRedTeamingProvider factory", () => {
  it("selects custom by default (off / unset env)", () => {
    const provider = resolveAiRedTeamingProvider({ env: {} });
    expect(provider.name).toBe("custom");
  });

  it(`selects zscaler when ${AI_RED_TEAM_PROVIDER_ENV}=zscaler`, () => {
    const provider = resolveAiRedTeamingProvider({
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
    });
    expect(provider.name).toBe("zscaler");
  });

  it("honors explicit provider override over env", () => {
    const provider = resolveAiRedTeamingProvider({
      provider: "custom",
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
    });
    expect(provider.name).toBe("custom");
  });

  it("returns injected client when provided", () => {
    const client = createCustomAiRedTeamingProvider();
    expect(resolveAiRedTeamingProvider({ client }).name).toBe("custom");
  });
});

describe("custom provider", () => {
  it("healthCheck is ok in mock mode", async () => {
    const provider = createCustomAiRedTeamingProvider();
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("mock");
    expect(health.provider).toBe("custom");
    expect(isMockNote(health.message)).toBe(true);
  });

  it("runProbes returns ATLAS/OWASP-mapped findings", async () => {
    const provider = createCustomAiRedTeamingProvider();
    const result = await provider.runProbes(target, frameworks);
    expect(result.provider).toBe("custom");
    expect(result.mode).toBe("mock");
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) {
      expect(f.atlas.length + f.owasp.length).toBeGreaterThan(0);
      expect(isMockNote(f.summary)).toBe(true);
    }
  });
});

describe("zscaler provider MOCK without credentials", () => {
  it("healthCheck reports MOCK when no credentials", async () => {
    const provider = createZscalerAiRedTeamingProvider({ env: {}, apiKey: null });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("mock");
    expect(health.provider).toBe("zscaler");
    expect(isMockNote(health.message)).toBe(true);
  });

  it("runProbes returns MOCK-labeled sample findings mapped to ATLAS/OWASP", async () => {
    const provider = createZscalerAiRedTeamingProvider({ env: {}, apiKey: null });
    const result = await provider.runProbes(target, frameworks);
    expect(result.provider).toBe("zscaler");
    expect(result.mode).toBe("mock");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(isMockNote(result.summary)).toBe(true);
    expect(result.mocksUsed.some((m) => m.mockLabel === "zscaler-ai-red-teaming")).toBe(
      true,
    );

    for (const f of result.findings) {
      expect(f.mocked).toBe(true);
      expect(f.title.startsWith("MOCK:") || isMockNote(f.summary)).toBe(true);
      expect(isMockNote(f.summary)).toBe(true);
      expect(f.atlas.length).toBeGreaterThan(0);
      expect(f.owasp.length).toBeGreaterThan(0);
    }

    const atlasIds = result.findings.flatMap((f) => f.atlas);
    const owaspIds = result.findings.flatMap((f) => f.owasp);
    expect(atlasIds.some((id) => id.startsWith("AML."))).toBe(true);
    expect(owaspIds.some((id) => id.startsWith("LLM"))).toBe(true);
  });

  it("factory zscaler path without credentials yields MOCK findings", async () => {
    const provider = resolveAiRedTeamingProvider({
      env: { [AI_RED_TEAM_PROVIDER_ENV]: "zscaler" },
      zscalerApiKey: null,
    });
    expect(provider.name).toBe("zscaler");
    const result = await provider.runProbes(target, ["atlas"]);
    expect(result.mode).toBe("mock");
    expect(result.findings.every((f) => f.mocked)).toBe(true);
  });
});

describe("zscaler provider with credentials (not wired)", () => {
  it("healthCheck reports not_wired and runProbes throws", async () => {
    const provider = createZscalerAiRedTeamingProvider({
      apiKey: "test-key-not-for-live-use",
    });
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.mode).toBe("not_wired");

    await expect(provider.runProbes(target, frameworks)).rejects.toMatchObject({
      name: "ZscalerAiRedTeamNotWiredError",
      code: ZSCALER_NOT_WIRED_CODE,
    });
    await expect(provider.runProbes(target, frameworks)).rejects.toBeInstanceOf(
      ZscalerAiRedTeamNotWiredError,
    );
  });

  it("reads the local template without echoing secrets or calling out", async () => {
    const secret = "local-placeholder-not-a-real-key";
    const endpoint = "https://example.zscaler.com/api/v1/ai-red-team";
    const env = {
      NODE_ENV: "test",
      ZSCALER_AI_RED_TEAM_API_KEY: secret,
      ZSCALER_AI_RED_TEAM_ENDPOINT: endpoint,
      ZSCALER_AI_RED_TEAM_SCAN_SCOPE: "prompts, models",
      ZSCALER_AI_RED_TEAM_FINDINGS_ROUTING: "report-only",
    } as NodeJS.ProcessEnv;

    expect(resolveZscalerLocalConfig(env)).toEqual({
      credentialEnvKey: "ZSCALER_AI_RED_TEAM_API_KEY",
      endpointConfigured: true,
      scanScope: ["prompts", "models"],
      findingsRouting: "report-only",
    });

    const provider = createZscalerAiRedTeamingProvider({ env });
    const health = await provider.healthCheck();
    expect(health.mode).toBe("not_wired");
    expect(health.message).toContain("findingsRouting=report-only");
    expect(health.message).toContain("endpointConfigured=true");
    expect(health.message).not.toContain(secret);
    expect(health.message).not.toContain(endpoint);
    await expect(provider.runProbes(target, frameworks)).rejects.toBeInstanceOf(
      ZscalerAiRedTeamNotWiredError,
    );
  });

  it("ignores an unknown findings routing value", () => {
    const config = resolveZscalerLocalConfig({
      NODE_ENV: "test",
      ZSCALER_AI_RED_TEAM_FINDINGS_ROUTING: "auto-merge",
    } as NodeJS.ProcessEnv);
    expect(config.findingsRouting).toBeUndefined();
    expect(config.credentialEnvKey).toBeUndefined();
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
        provider: "zscaler",
        mcpContext: "zscaler-mcp-red-team",
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
    expect(result.context.mcpContext).toBe("zscaler-mcp-red-team");
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
        provider: "zscaler",
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
      context: { provider: "custom", findingsRouting: "report-only" },
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
