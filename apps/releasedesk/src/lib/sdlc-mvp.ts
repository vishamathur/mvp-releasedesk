/**
 * SDLC MVP portfolio check — agility · security · token efficiency.
 *
 * Runs Lead on-demand checks across DEMO_PORTFOLIO (stubs + MOCK PR),
 * evaluates mandatory Security participation, and compares security-role
 * context slices vs full-run packing for token/margin savings.
 */
import {
  DEMO_PORTFOLIO,
  SDLC_AGENT_DEFINITIONS,
  buildRoleContextSlice,
  compareFullRunVsSlice,
  createInMemoryStore,
  evaluateSecurityParticipation,
  listAgentCredentialStatuses,
  type AgentCredentialStatus,
  type PortfolioCustomerApp,
  type SecurityParticipationResult,
  type SdlcAgentDefinition,
  type TokenBudgetComparison,
} from "@releasedesk/core";
import {
  LeadOrchestrator,
  createDefaultStubRunners,
  createMockPrClient,
  type ReleaseCheckReport,
} from "@releasedesk/lead";

export type SdlcMvpCustomerResult = {
  customerId: string;
  customerName: string;
  application: string;
  repository: string;
  runId: string;
  readiness: ReleaseCheckReport["leadOutput"]["readiness"];
  blockingIssues: string[];
  security: SecurityParticipationResult;
  tokenBudget: TokenBudgetComparison;
  mockIntegrations: {
    specialists: true;
    prClient: "mock";
  };
};

export type SdlcMvpPortfolioReport = {
  generatedAt: string;
  requirements: {
    agility: {
      label: string;
      summary: string;
      customersChecked: number;
      allTaggedWithCustomerId: boolean;
    };
    security: {
      label: string;
      summary: string;
      mandatoryOnEveryChange: true;
      allCustomersOk: boolean;
    };
    tokenEfficiency: {
      label: string;
      summary: string;
      totalSavingsTokensEst: number;
      averageSavingsPct: number;
    };
  };
  customers: SdlcMvpCustomerResult[];
  agents: SdlcAgentDefinition[];
  credentials: AgentCredentialStatus[];
  mockNote: string;
};

function createLead(): LeadOrchestrator {
  return new LeadOrchestrator({
    store: createInMemoryStore(),
    runners: createDefaultStubRunners(),
    enableRemediation: true,
    maxRemediationCycles: 2,
    prClient: { client: createMockPrClient() },
  });
}

async function checkCustomer(
  customer: PortfolioCustomerApp,
): Promise<SdlcMvpCustomerResult> {
  const lead = createLead();
  const report = await lead.startOnDemandCheck({
    goal: `SDLC MVP release check — ${customer.customerName} / ${customer.application}`,
    target: {
      repository: customer.repository,
      ...(customer.baseRef !== undefined ? { baseRef: customer.baseRef } : {}),
      ...(customer.headRef !== undefined ? { headRef: customer.headRef } : {}),
    },
    trigger: {
      requestedBy: "sdlc-mvp",
      notes: `Portfolio check for ${customer.customerId}`,
    },
    metadata: {
      customerId: customer.customerId,
      customerName: customer.customerName,
      application: customer.application,
      sdlcMvp: true,
    },
  });

  const security = evaluateSecurityParticipation(report.run.tasks);
  const slice = buildRoleContextSlice(report.run, "security");
  const tokenBudget = compareFullRunVsSlice(report.run, slice);

  return {
    customerId: customer.customerId,
    customerName: customer.customerName,
    application: customer.application,
    repository: customer.repository,
    runId: report.runId,
    readiness: report.leadOutput.readiness,
    blockingIssues: report.leadOutput.blockingIssues,
    security,
    tokenBudget,
    mockIntegrations: {
      specialists: true,
      prClient: "mock",
    },
  };
}

/** Run portfolio checks for every DEMO_PORTFOLIO customer and aggregate. */
export async function runSdlcMvpPortfolioCheck(
  portfolio: readonly PortfolioCustomerApp[] = DEMO_PORTFOLIO,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<SdlcMvpPortfolioReport> {
  const customers: SdlcMvpCustomerResult[] = [];
  for (const customer of portfolio) {
    customers.push(await checkCustomer(customer));
  }

  const allTagged = customers.every(
    (c) => typeof c.customerId === "string" && c.customerId.length > 0,
  );
  const allSecurityOk = customers.every((c) => c.security.ok);
  const totalSavingsTokensEst = customers.reduce(
    (sum, c) => sum + c.tokenBudget.savingsTokensEst,
    0,
  );
  const averageSavingsPct =
    customers.length === 0
      ? 0
      : Math.round(
          (customers.reduce((sum, c) => sum + c.tokenBudget.savingsPct, 0) /
            customers.length) *
            10,
        ) / 10;

  return {
    generatedAt: new Date().toISOString(),
    requirements: {
      agility: {
        label: "Agility",
        summary:
          "On-demand release checks across the multi-customer portfolio, each tagged with customerId.",
        customersChecked: customers.length,
        allTaggedWithCustomerId: allTagged,
      },
      security: {
        label: "Security",
        summary:
          "Mandatory Security specialist participation on every change — no selective skip.",
        mandatoryOnEveryChange: true,
        allCustomersOk: allSecurityOk,
      },
      tokenEfficiency: {
        label: "Token efficiency",
        summary:
          "Security-role context slices vs full-run packing — lean prompts protect ITS margin.",
        totalSavingsTokensEst,
        averageSavingsPct,
      },
    },
    customers,
    agents: [...SDLC_AGENT_DEFINITIONS],
    credentials: listAgentCredentialStatuses(env as NodeJS.ProcessEnv),
    mockNote:
      "Specialists and GitHub PR client are MOCK for this MVP surface. Per-agent API keys are exclusive — never shared; missing keys keep that agent on MOCK paths.",
  };
}

/** Agent catalog + credential presence (never secret values). */
export function getSdlcMvpCatalog(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): {
  agents: SdlcAgentDefinition[];
  credentials: AgentCredentialStatus[];
  portfolio: PortfolioCustomerApp[];
  requirements: SdlcMvpPortfolioReport["requirements"];
} {
  return {
    agents: [...SDLC_AGENT_DEFINITIONS],
    credentials: listAgentCredentialStatuses(env as NodeJS.ProcessEnv),
    portfolio: [...DEMO_PORTFOLIO],
    requirements: {
      agility: {
        label: "Agility",
        summary:
          "On-demand release checks across the multi-customer portfolio, each tagged with customerId.",
        customersChecked: DEMO_PORTFOLIO.length,
        allTaggedWithCustomerId: true,
      },
      security: {
        label: "Security",
        summary:
          "Mandatory Security specialist participation on every change — no selective skip.",
        mandatoryOnEveryChange: true,
        allCustomersOk: false,
      },
      tokenEfficiency: {
        label: "Token efficiency",
        summary:
          "Security-role context slices vs full-run packing — lean prompts protect ITS margin.",
        totalSavingsTokensEst: 0,
        averageSavingsPct: 0,
      },
    },
  };
}
