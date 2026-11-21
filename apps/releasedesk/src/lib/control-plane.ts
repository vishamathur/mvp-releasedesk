/**
 * Desk snapshot of the SDLC. Bot handoffs run in the Grok Bot app.
 * This module does not start the Lead orchestrator and does not approve gates.
 */
import path from "node:path";
import {
  DEMO_PORTFOLIO,
  SDLC_AGENT_DEFINITIONS,
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
    approvals: [],
  });

  const sample = DEMO_PORTFOLIO[0]!;
  const security = evaluateSecurityParticipation([]);
  const tokenBudget = {
    fullRunChars: 0,
    fullRunTokensEst: 0,
    sliceChars: 0,
    sliceTokensEst: 0,
    savingsTokensEst: 0,
    savingsPct: 0,
  };

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
      summary: "Lead · Change Analyst · Standards · Security · Builder hand off inside the Grok Bot app.",
      status: "ready",
      detail: `${bots.length} bot definition(s) · Builder launches the Cursor cloud agent · no per-bot API keys`,
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
      summary: "Hard gate — a human red_team or security signature is required. Desk does not sign it.",
      status: iterationGate.canProceed ? "ready" : "blocked",
      detail: iterationGate.canProceed
        ? "human red_team|security signature recorded"
        : iterationGate.blockingIssue,
    },
    {
      id: "cursor_grok_ship",
      label: "5 · Cursor ships code → Grok API",
      summary: "Coding agent ships; desk + specialists call classify/extract/score/summarize.",
      status: deskIntel.mocked ? "mock" : "live",
      detail: deskIntel.mocked
        ? `MOCK until ${deskIntel.trustCheck.keyEnvVar} is set`
        : `Live via ${deskIntel.trustCheck.keyEnvVar} json_schema`,
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
      summary: "Portfolio customers. One app Grok key. Desk does not run the bot handoff.",
      status: presentKeys > 0 ? "live" : "mock",
      detail: `${DEMO_PORTFOLIO.length} customers · app key ${presentKeys}/${nhiCredentials.length} present · Security participation is a Grok Bot stage`,
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
      "live Grok intel: set XAI_API_KEY in apps/releasedesk/.env.local (never commit it)",
      "bot flow: docs/sdlc/overview.md — #er-intake or #new-customer",
    ],
  };
}
