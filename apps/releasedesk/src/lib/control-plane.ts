/**
 * Enterprise SDLC control plane snapshot — intake → bots → ATLAS/OWASP →
 * iteration gate → Cursor→Grok ship → human merge/release, with portfolio
 * token efficiency and NHI exclusive keys.
 */
import path from "node:path";
import {
  DEMO_PORTFOLIO,
  SDLC_AGENT_DEFINITIONS,
  buildRoleContextSlice,
  compareFullRunVsSlice,
  createInMemoryStore,
  createZscalerMockFindings,
  evaluateIterationProceedGate,
  evaluateSecurityParticipation,
  listAgentCredentialStatuses,
  listGrokBotDefinitions,
  runCollapsedAiRedTeamGate,
  type AgentCredentialStatus,
  type CollapsedAiRedTeamGateResult,
  type IterationProceedGate,
  type PortfolioCustomerApp,
  type SdlcAgentDefinition,
  type SecurityParticipationGate,
  type TokenBudgetComparison,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  createDefaultStubRunners,
  createMockPrClient,
} from "@releasedesk/lead";
import {
  classifyReleaseFindings,
  extractReleaseActions,
  scoreReleaseRisk,
  summarizeReleaseFindings,
} from "@releasedesk/specialists";
import { getIntakeList, type IntakeListResponse } from "./intake";
import { runGrokReleaseIntel, type GrokReleaseIntelResult } from "./grok-release-intel";

export type ControlPlaneStageId =
  | "intake"
  | "grok_bots"
  | "atlas_owasp"
  | "iteration_gate"
  | "cursor_grok_ship"
  | "human_merge_release"
  | "portfolio_token_nhi";

export type ControlPlaneStage = {
  id: ControlPlaneStageId;
  label: string;
  summary: string;
  status: "ready" | "blocked" | "mock" | "live";
  detail?: string;
};

export type ControlPlaneSnapshot = {
  generatedAt: string;
  title: "Release Desk SDLC Control Plane";
  stages: ControlPlaneStage[];
  intake: {
    itemCount: number;
    customers: IntakeListResponse["customers"];
    leadReadyCount: number;
  };
  bots: {
    definitions: Array<{ id: string; name: string; definitionPath?: string }>;
    agents: SdlcAgentDefinition[];
  };
  atlasOwasp: {
    gate: CollapsedAiRedTeamGateResult;
    findingCount: number;
    atlasTags: string[];
    owaspTags: string[];
  };
  iterationGate: IterationProceedGate;
  ship: {
    path: string;
    deskIntel: GrokReleaseIntelResult;
    specialistIntel: {
      classify: { mocked: boolean; text: string };
      extract: { mocked: boolean; text: string };
      score: { mocked: boolean; text: string };
      summarize: { mocked: boolean; text: string };
    };
  };
  portfolio: {
    customers: PortfolioCustomerApp[];
    security: SecurityParticipationGate;
    tokenBudget: TokenBudgetComparison;
  };
  nhiCredentials: AgentCredentialStatus[];
  demoPath: string[];
};

function workspaceRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}releasedesk`) || cwd.endsWith("/releasedesk")) {
    return path.join(cwd, "..", "..");
  }
  return cwd;
}

async function listBotDefs(): Promise<
  Array<{ id: string; name: string; definitionPath?: string }>
> {
  try {
    const defs = await listGrokBotDefinitions(workspaceRoot());
    return defs.map((d) => ({
      id: d.id,
      name: d.displayName,
      definitionPath: `grok-bots/definitions/${d.id}.json`,
    }));
  } catch {
    return SDLC_AGENT_DEFINITIONS.filter((a) => a.runtime !== "cursor_cloud").map((a) => ({
      id: a.id,
      name: a.label,
      definitionPath: `grok-bots/definitions/${a.id.replaceAll("_", "-")}.json`,
    }));
  }
}

/** Build a full control-plane snapshot for Desk / CLI demo. */
export async function buildControlPlaneSnapshot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<ControlPlaneSnapshot> {
  const intake = await getIntakeList().catch(() => ({
    items: [] as IntakeListResponse["items"],
    byCustomer: {},
    costsByCustomer: {},
    customers: DEMO_PORTFOLIO.map((c) => ({
      customerId: c.customerId,
      name: c.customerName,
      weight: 1,
    })),
  }));

  const findings = createZscalerMockFindings("northwind-kyc");
  const atlasTags = [...new Set(findings.flatMap((f) => f.atlas))];
  const owaspTags = [...new Set(findings.flatMap((f) => f.owasp))];

  const collapsed = runCollapsedAiRedTeamGate({
    iterationId: "iter_control_plane_demo",
    context: {
      provider: "zscaler",
      mcpContext: "zscaler-mcp-red-team",
      findingsRouting: "block",
    },
    preReleaseFindings: findings.slice(0, 2),
    postRemediationFindings: findings.slice(2),
    approvals: [],
  });

  const iterationGate = evaluateIterationProceedGate({
    iterationId: "iter_control_plane_demo",
    approvals: [
      {
        iterationId: "iter_control_plane_demo",
        kind: "security",
        approvedBy: "control-plane-demo",
        approvedAt: new Date().toISOString(),
        note: "Demo security sign-off — live room can use red_team instead",
      },
    ],
  });

  const lead = new LeadOrchestrator({
    store: createInMemoryStore(),
    runners: createDefaultStubRunners(),
    enableRemediation: true,
    maxRemediationCycles: 1,
    prClient: { client: createMockPrClient() },
  });
  const sample = DEMO_PORTFOLIO[0]!;
  const report = await lead.startOnDemandCheck({
    goal: `Control plane release check — ${sample.customerName}`,
    target: {
      repository: sample.repository,
      ...(sample.baseRef ? { baseRef: sample.baseRef } : {}),
      ...(sample.headRef ? { headRef: sample.headRef } : {}),
    },
    trigger: { requestedBy: "control-plane", notes: "Enterprise SDLC demo" },
    metadata: { customerId: sample.customerId, controlPlane: true },
  });
  const security = evaluateSecurityParticipation(report.run.tasks);
  const slice = buildRoleContextSlice(report.run, "security");
  const tokenBudget = compareFullRunVsSlice(report.run, slice);

  const intelFindings = findings.map((f) => ({
    id: f.id,
    sourceAgent: "security",
    summary: f.summary,
    severity: f.severity,
  }));
  const envBag = env as NodeJS.ProcessEnv;
  const [classify, extract, score, summarize] = await Promise.all([
    classifyReleaseFindings(intelFindings, { env: envBag }),
    extractReleaseActions(intelFindings, { env: envBag }),
    scoreReleaseRisk(intelFindings, { env: envBag }),
    summarizeReleaseFindings(intelFindings, { env: envBag }),
  ]);

  const deskIntel = await runGrokReleaseIntel(
    {
      repository: sample.repository,
      goal: "Control plane Grok API ship proof",
      findings: findings.map((f) => ({
        source: "security",
        text: f.summary,
        severity: f.severity,
      })),
    },
    { env: envBag },
  );

  const bots = await listBotDefs();
  const nhiCredentials = listAgentCredentialStatuses(envBag);
  const presentKeys = nhiCredentials.filter((c) => c.present).length;

  const stages: ControlPlaneStage[] = [
    {
      id: "intake",
      label: "1 · Multi-customer intake",
      summary: "Weighted backlog + dual approvals before Lead starts a check.",
      status: intake.items.length ? "ready" : "mock",
      detail: `${intake.items.length} backlog item(s) · ${intake.customers.length} customer(s)`,
    },
    {
      id: "grok_bots",
      label: "2 · Grok Bots (Lead + specialists)",
      summary: "Lead · Change Analyst · Standards · Security · Builder — exclusive keys.",
      status: "ready",
      detail: `${bots.length} bot definition(s) · Coding/Testing/Review Cursor CAs nested under Builder`,
    },
    {
      id: "atlas_owasp",
      label: "3 · ATLAS / OWASP AI Red Team",
      summary: "Collapsed gate maps findings to MITRE ATLAS + OWASP LLM Top 10.",
      status: collapsed.releaseBlockingCount > 0 ? "blocked" : "ready",
      detail: `${findings.length} findings · ATLAS ${atlasTags.join(",") || "—"} · OWASP ${owaspTags.join(",") || "—"}`,
    },
    {
      id: "iteration_gate",
      label: "4 · Iteration gate (red_team | security)",
      summary: "Hard #14 gate — neither approval → cannot proceed.",
      status: iterationGate.canProceed ? "ready" : "blocked",
      detail: iterationGate.canProceed
        ? "security approval recorded (demo)"
        : iterationGate.blockingIssue,
    },
    {
      id: "cursor_grok_ship",
      label: "5 · Cursor ships code → Grok API",
      summary: "Coding agent ships; desk + specialists call classify/extract/score/summarize.",
      status: deskIntel.mocked ? "mock" : "live",
      detail: deskIntel.mocked
        ? `MOCK without exclusive key (${deskIntel.trustCheck.keyEnvVar})`
        : `Live via ${deskIntel.trustCheck.keyEnvVar}`,
    },
    {
      id: "human_merge_release",
      label: "6 · Human merge / release",
      summary: "Never auto-merge. Feature sign-off + merge/release approvals remain human.",
      status: iterationGate.canProceed ? "ready" : "blocked",
      detail: "ApprovalGates + FeatureSignOff on run page",
    },
    {
      id: "portfolio_token_nhi",
      label: "7 · Portfolio · token efficiency · NHI keys",
      summary: "Multi-customer DEMO_PORTFOLIO, security-slice tokens, exclusive NHI env vars.",
      status: presentKeys > 0 ? "live" : "mock",
      detail: `${DEMO_PORTFOLIO.length} customers · slice save ~${tokenBudget.savingsTokensEst} tok · ${presentKeys}/${nhiCredentials.length} NHI keys present`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    title: "Release Desk SDLC Control Plane",
    stages,
    intake: {
      itemCount: intake.items.length,
      customers: intake.customers,
      leadReadyCount: intake.items.filter((i) => i.leadReady).length,
    },
    bots: {
      definitions: bots,
      agents: [...SDLC_AGENT_DEFINITIONS],
    },
    atlasOwasp: {
      gate: collapsed,
      findingCount: findings.length,
      atlasTags,
      owaspTags,
    },
    iterationGate,
    ship: {
      path: "packages/releasedesk-specialists/src/grok-api-intel.ts + apps/releasedesk/src/lib/grok-release-intel.ts",
      deskIntel,
      specialistIntel: {
        classify: { mocked: classify.mocked, text: classify.text },
        extract: { mocked: extract.mocked, text: extract.text },
        score: { mocked: score.mocked, text: score.text },
        summarize: { mocked: summarize.mocked, text: summarize.text },
      },
    },
    portfolio: {
      customers: [...DEMO_PORTFOLIO],
      security,
      tokenBudget,
    },
    nhiCredentials,
    demoPath: [
      "npm run build:core && npm run build:lead && npm run build:specialists",
      "npm run desk",
      "open http://localhost:3002/control",
      "optional live: export RELEASEDESK_GROK_API_KEY_BUILDER=... RELEASEDESK_GROK_API_KEY_LEAD=...",
      "npm run demo:control-plane",
    ],
  };
}
