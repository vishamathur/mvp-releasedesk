import {
  formatMockNote,
  createMockMeta,
  nowIso,
  type MockMeta,
} from "@releasedesk/core";
import type {
  AgentRunner,
  AgentRunInvocation,
  AgentRunResult,
  SpecialistRole,
} from "@releasedesk/lead";
import { createAiRedTeamingRunner } from "../ai-red-teaming.js";
import { createBuilderRunner } from "../builder.js";
import { createChangeAnalystRunner } from "../change-analyst.js";
import type { SpecialistRunnerOptions } from "../options.js";
import { createSecurityRunner } from "../security.js";
import { createStandardsRunner } from "../standards.js";
import { resolveCloudAgentClient } from "./resolve.js";
import type {
  CloudAgentClient,
  CloudAgentDispatchResult,
  SharedRunContextRef,
  SpecialistCloudAgentKind,
} from "./types.js";

const ROLE_TO_CLOUD_KIND: Record<SpecialistRole, SpecialistCloudAgentKind> = {
  change_analyst: "change_analyst",
  standards: "standards",
  security: "security",
  builder: "builder",
  ai_red_teaming: "ai_red_teaming",
};

export type CloudSpecialistRunnerOptions = SpecialistRunnerOptions & {
  /**
   * Durable shared run-context URI (FileBackedRunContextStore path).
   * Passed into every specialist Cloud Agent dispatch.
   */
  storeUri?: string;
  /**
   * When true (default), MOCK mode still executes local specialist analysis
   * after allocating a mock cloud-agent identity — simulates an ephemeral VM
   * with the repo checked out without needing CURSOR_API_KEY.
   */
  executeLocalAnalysisInMock?: boolean;
};

function buildLocalRunners(
  options: SpecialistRunnerOptions,
): Record<SpecialistRole, AgentRunner> {
  // Builder still dispatches nested coding/testing/review Cloud Agents.
  return {
    change_analyst: createChangeAnalystRunner(options),
    standards: createStandardsRunner(options),
    security: createSecurityRunner(options),
    builder: createBuilderRunner(options),
    ai_red_teaming: createAiRedTeamingRunner(options),
  };
}

function promptForRole(role: SpecialistRole, inv: AgentRunInvocation): string {
  const repo = String(inv.run.target.repository ?? "unknown/repo");
  const base = [
    `Release Desk specialist Cloud Agent: ${role}`,
    `runId=${inv.runId} taskId=${inv.taskId} attempt=${inv.attempt}`,
    `repository=${repo}`,
    `goal=${inv.run.goal}`,
    "Write structured results into the shared run-context store.",
    "Do NOT merge PRs. Human Desk gates remain authoritative.",
  ];
  if (role === "builder") {
    base.push(
      "After planning remediation, dispatch Coding then Testing∥Review Cloud Agents.",
    );
  }
  if (role === "ai_red_teaming") {
    base.push(
      "Apply MITRE ATLAS + OWASP LLM Top 10; flag Lead via durable store events.",
    );
  }
  return base.join("\n");
}

function acceptanceForRole(role: SpecialistRole): string[] {
  switch (role) {
    case "change_analyst":
      return ["Impact findings with evidence", "Release notes draft", "No store self-mutation"];
    case "standards":
      return ["Policy deviations with policy_ref evidence", "Compliant flag set"];
    case "security":
      return ["Advisory correlation recorded", "Mandatory Security participation"];
    case "builder":
      return [
        "Coding→Testing∥Review dispatched",
        "proposedBranch / testsPassed / proposedPrUrl tracked",
        "Never auto-merge",
      ];
    case "ai_red_teaming":
      return ["ATLAS/OWASP probes recorded", "Realtime flags persisted for Lead"];
    default:
      return ["Structured payload recorded"];
  }
}

function attachCloudMeta(
  result: AgentRunResult,
  cloud: CloudAgentDispatchResult,
  mocks: MockMeta[],
): AgentRunResult {
  const cloudMocks = cloud.mock ? [...mocks, cloud.mock] : mocks;
  return {
    ...result,
    payload: {
      ...result.payload,
      cloudAgentId: cloud.cloudAgentId,
      cloudRunId: cloud.cloudRunId,
      cloudAgentUrl: cloud.cloudAgentUrl,
      cloudAgentApi: cloud.mocked ? "mock" : "real",
      ephemeralCloudAgent: true,
      cloudDispatchAttempt: cloud.attempt,
      cloudSummary: cloud.summary,
    },
    mocksUsed: [...(result.mocksUsed ?? []), ...cloudMocks],
    summary: result.summary,
  };
}

function failedFromCloud(
  role: SpecialistRole,
  cloud: CloudAgentDispatchResult,
): AgentRunResult {
  const mock =
    cloud.mock ??
    createMockMeta("cursor-cloud-agents", `Cloud Agent ${role} failed`);
  return {
    status: "failed",
    summary: cloud.summary,
    payload: {
      agentRole: role,
      cloudAgentId: cloud.cloudAgentId,
      cloudRunId: cloud.cloudRunId,
      cloudAgentUrl: cloud.cloudAgentUrl,
      cloudAgentApi: cloud.mocked ? "mock" : "real",
      ephemeralCloudAgent: true,
      error: cloud.error,
    },
    failure: {
      code: "cloud_agent_failed",
      message: cloud.error ?? cloud.summary,
      retryable: true,
      failedAt: nowIso(),
    },
    mocksUsed: [mock],
  };
}

/**
 * Specialist runners that dispatch as ephemeral Cursor Cloud Agents
 * via the same `CloudAgentClient` as Coding/Testing/Review (MOCK default).
 *
 * Lead injects these instead of plain in-process Node runners. Desk remains
 * the always-on surface; specialists are request-scoped Cloud Agent runs.
 */
export function createCloudSpecialistRunners(
  options: CloudSpecialistRunnerOptions = {},
): Record<SpecialistRole, AgentRunner> {
  const client: CloudAgentClient =
    options.cloudClient ?? resolveCloudAgentClient(options.cloud ?? {});
  const executeLocal = options.executeLocalAnalysisInMock !== false;
  const local = buildLocalRunners({
    ...options,
    cloudClient: client,
  });

  const wrap = (role: SpecialistRole): AgentRunner => {
    return async (inv: AgentRunInvocation): Promise<AgentRunResult> => {
      const kind = ROLE_TO_CLOUD_KIND[role];
      const repository =
        String(inv.run.target.repository ?? "vishamathur/mvp-releasedesk");
      const baseBranch = String(inv.run.target.baseRef ?? "main");
      const proposedBranch = `cursor/rd-${role}-${inv.taskId.slice(-8)}`;

      const sharedContext: SharedRunContextRef | undefined = options.storeUri
        ? {
            storeUri: options.storeUri,
            runId: inv.runId,
            taskId: inv.taskId,
          }
        : inv.run.metadata &&
            typeof (inv.run.metadata as { sharedStoreUri?: unknown }).sharedStoreUri ===
              "string"
          ? {
              storeUri: String(
                (inv.run.metadata as { sharedStoreUri: string }).sharedStoreUri,
              ),
              runId: inv.runId,
              taskId: inv.taskId,
            }
          : undefined;

      const cloud = await client.dispatch({
        handoffId: `specialist_${role}_${inv.taskId}`,
        agentKind: kind,
        prompt: promptForRole(role, inv),
        repository,
        baseBranch,
        proposedBranch,
        acceptanceCriteria: acceptanceForRole(role),
        branch: proposedBranch,
        autoMerge: false,
        ...(sharedContext ? { sharedContext } : {}),
      });

      if (cloud.status === "failed") {
        return failedFromCloud(role, cloud);
      }

      // MOCK (default / CI): allocate cloud identity then run local analysis
      // as the ephemeral agent body — no CURSOR_API_KEY required.
      if (client.mode === "mock" && executeLocal) {
        const localResult = await local[role](inv);
        return attachCloudMeta(localResult, cloud, []);
      }

      // Real Cloud Agent: parse provider/summary into a minimal completed payload.
      // Structured specialist analysis in live mode lands via agent result text;
      // Lead still validates contracts when present.
      if (client.mode === "real") {
        const mockNote = formatMockNote(
          "Real Cloud Agent returned; structured parse is best-effort from summary",
        );
        return {
          status: "completed",
          summary: cloud.summary || mockNote,
          payload: {
            agentRole: role,
            cloudAgentId: cloud.cloudAgentId,
            cloudRunId: cloud.cloudRunId,
            cloudAgentUrl: cloud.cloudAgentUrl,
            cloudAgentApi: "real",
            ephemeralCloudAgent: true,
            provider: cloud.provider ?? {},
            rawSummary: cloud.summary,
          },
          evidence: [
            {
              kind: "artifact",
              title: `${role} Cloud Agent result`,
              summary: cloud.summary.slice(0, 500),
              source: role,
              data: {
                cloudAgentUrl: cloud.cloudAgentUrl,
                cloudAgentId: cloud.cloudAgentId,
              },
            },
          ],
        };
      }

      // MOCK without local execution — identity-only success.
      return {
        status: "completed",
        summary: cloud.summary,
        payload: {
          agentRole: role,
          cloudAgentId: cloud.cloudAgentId,
          cloudRunId: cloud.cloudRunId,
          cloudAgentUrl: cloud.cloudAgentUrl,
          cloudAgentApi: "mock",
          ephemeralCloudAgent: true,
        },
        mocksUsed: cloud.mock ? [cloud.mock] : [],
      };
    };
  };

  return {
    change_analyst: wrap("change_analyst"),
    standards: wrap("standards"),
    security: wrap("security"),
    builder: wrap("builder"),
    ai_red_teaming: wrap("ai_red_teaming"),
  };
}
