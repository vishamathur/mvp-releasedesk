import {
  createEvidenceItem,
  createMockMeta,
  formatMockNote,
} from "@releasedesk/core";
import {
  createDefaultStubRunners,
  type AgentRunner,
  type AgentRunnerMap,
} from "@releasedesk/lead";
import type { DemoScenarioId, DemoScenarioMeta } from "./types";

export const DEMO_SCENARIOS: DemoScenarioMeta[] = [
  {
    id: "happy-path",
    title: "Happy path",
    blurb: "Clean specialist wave → pending merge & release gates. Approve to mark ready.",
    expectedReadiness: "needs_human → ready (after approve)",
  },
  {
    id: "remediation-loop",
    title: "Remediation loop",
    blurb:
      "Security blocks first, Builder remediates, reverify clears → feature checklist + merge/release gates.",
    expectedReadiness: "needs_human (feature sign-off + gates)",
  },
  {
    id: "blocked-on-security",
    title: "Blocked on security",
    blurb:
      "Release-blocking security findings persist after remediation. Feature checklist + gates stay pending until you reject → not_ready.",
    expectedReadiness: "needs_human (security blockers) → not_ready on reject",
  },
  {
    id: "pending-approval",
    title: "Pending approval",
    blurb: "Clean check waiting on DM merge + release decisions (gates still pending).",
    expectedReadiness: "needs_human",
  },
  {
    id: "iteration-approval-gate",
    title: "Iteration approval gate",
    blurb:
      "Collapsed AI Red Team gate: pending code iteration blocked until red team OR security sign-off. Approve to open; reject to keep blocked. Remediation stays on a non-blocking side-queue.",
    expectedReadiness: "needs_human (iteration gate pending → open/blocked)",
  },
];

function blockingSecurity(inv: Parameters<AgentRunner>[0]): Awaited<ReturnType<AgentRunner>> {
  void inv;
  const mock = createMockMeta("security-scenario", "Injected release-blocking finding for demo");
  return {
    status: "completed",
    summary: formatMockNote("Security check — 1 release-blocking finding"),
    payload: {
      agentRole: "security",
      findings: [
        {
          id: "SEC-DEMO-1",
          title: "Hardcoded credentials in KYC risk stub path",
          severity: "critical",
          releaseBlocking: true,
          component: "apps/kyc",
          summary: formatMockNote("Demo blocking advisory correlated to KYC risk module"),
        },
      ],
      releaseBlockingCount: 1,
      riskLevel: "critical",
      evidence: [
        createEvidenceItem({
          kind: "advisory",
          title: "Blocking advisory (demo)",
          summary: formatMockNote("Release-blocking security finding for scenario"),
          source: "security",
          mock,
        }),
      ],
      mocksUsed: [mock],
    },
    evidence: [
      {
        kind: "advisory",
        title: "Blocking advisory (demo)",
        summary: formatMockNote("Release-blocking security finding for scenario"),
        source: "security",
        mock,
      },
    ],
    mocksUsed: [mock],
  };
}

/**
 * Scenario-specific stub runners. Each invocation records real orchestrator task
 * outputs — not hardcoded chat transcripts.
 */
export function runnersForScenario(scenarioId: DemoScenarioId): {
  runners: AgentRunnerMap;
  enableRemediation: boolean;
  maxRemediationCycles: number;
  goal: string;
} {
  const stubs = createDefaultStubRunners();

  switch (scenarioId) {
    case "happy-path":
    case "pending-approval":
      return {
        runners: stubs,
        enableRemediation: false,
        maxRemediationCycles: 0,
        goal:
          scenarioId === "happy-path"
            ? "Demo: happy-path release readiness for Northwind KYC"
            : "Demo: pending DM approval gates for Northwind KYC",
      };

    case "remediation-loop": {
      let securityCalls = 0;
      const security: AgentRunner = async (inv) => {
        securityCalls += 1;
        if (securityCalls === 1) return blockingSecurity(inv);
        return stubs.security(inv);
      };
      return {
        runners: { ...stubs, security },
        enableRemediation: true,
        maxRemediationCycles: 2,
        goal: "Demo: fail → remediate → reverify → pending approval",
      };
    }

    case "blocked-on-security": {
      const security: AgentRunner = async (inv) => blockingSecurity(inv);
      return {
        runners: { ...stubs, security },
        enableRemediation: true,
        maxRemediationCycles: 1,
        goal: "Demo: persistent security block on Northwind KYC release",
      };
    }

    case "iteration-approval-gate":
      return {
        runners: stubs,
        enableRemediation: false,
        maxRemediationCycles: 0,
        goal: "Demo: per-iteration red team|security approval hard gate",
      };

    default: {
      const _exhaustive: never = scenarioId;
      throw new Error(`Unknown scenario: ${_exhaustive}`);
    }
  }
}

export function isDemoScenarioId(value: string): value is DemoScenarioId {
  return DEMO_SCENARIOS.some((s) => s.id === value);
}
