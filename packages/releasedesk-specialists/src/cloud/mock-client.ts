import { createMockMeta, formatMockNote } from "@releasedesk/core";
import { CURSOR_API_KEY_ENV_BY_AGENT } from "./agent-keys.js";
import type {
  CloudAgentClient,
  CloudAgentDispatchRequest,
  CloudAgentDispatchResult,
  CloudAgentKind,
  OrchestrationCloudAgentKind,
} from "./types.js";
import { isBuilderCloudAgentKind, isOrchestrationCloudAgentKind } from "./types.js";

export type MockCloudAgentClientOptions = {
  /**
   * Force failures for specific agent kinds (tests).
   * Attempt numbers are 1-based; fails while attempt <= failUntilAttempt.
   */
  failUntilAttempt?: Partial<Record<CloudAgentKind, number>>;
  /** Override fabricated PR URL host path. */
  prUrlBase?: string;
};

/**
 * MOCK: Cursor Cloud Agent client — same interface as the real client.
 * Fabricates branch / test / PR / orchestration metadata without calling Cursor APIs.
 * Labeled with `MOCK:` / `mocked: true` so CI never needs live credentials.
 *
 * Covers Builder pipeline kinds (coding/testing/review) and orchestration kinds
 * (lead + specialists) so Desk can dispatch ephemeral Lead Cloud Agents on-demand.
 */
export function createMockCloudAgentClient(
  options: MockCloudAgentClientOptions = {},
): CloudAgentClient {
  const failUntil = options.failUntilAttempt ?? {};
  const attempts = new Map<string, number>();
  const prUrlBase =
    options.prUrlBase ?? "https://github.com/vishamathur/mvp-releasedesk/pull";

  return {
    mode: "mock",
    async dispatch(request: CloudAgentDispatchRequest): Promise<CloudAgentDispatchResult> {
      if (request.autoMerge !== false) {
        throw new Error("Release Desk Cloud Agents must not auto-merge");
      }

      const key = `${request.handoffId}:${request.agentKind}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);

      const failCap = failUntil[request.agentKind] ?? 0;
      if (attempt <= failCap) {
        const mock = createMockMeta(
          "cursor-cloud-agents",
          `Injected MOCK dispatch failure for ${request.agentKind} attempt ${attempt}`,
        );
        return {
          handoffId: request.handoffId,
          agentKind: request.agentKind,
          status: "failed",
          mocked: true,
          mock,
          summary: formatMockNote(
            `${request.agentKind} Cloud Agent dispatch failed (attempt ${attempt})`,
          ),
          attempt,
          error: `MOCK injected failure for ${request.agentKind} on attempt ${attempt}`,
        };
      }

      const mock = createMockMeta(
        "cursor-cloud-agents",
        "Cursor Cloud Agent API unavailable or MOCK mode; fabricated dispatch result",
      );

      const branch = request.branch ?? request.proposedBranch;
      const agentId = `bc-mock-${request.agentKind}-${request.handoffId.slice(-8)}`;
      const runId = `run-mock-${request.agentKind}-${attempt}`;
      const cloudAgentUrl = `https://cursor.com/agents/${agentId}`;

      if (isOrchestrationCloudAgentKind(request.agentKind)) {
        return mockOrchestrationResult(request, {
          mock,
          agentId,
          runId,
          cloudAgentUrl,
          branch,
          attempt,
        });
      }

      if (!isBuilderCloudAgentKind(request.agentKind)) {
        return {
          handoffId: request.handoffId,
          agentKind: request.agentKind,
          status: "failed",
          mocked: true,
          mock,
          summary: formatMockNote(`Unknown Cloud Agent kind ${String(request.agentKind)}`),
          attempt,
          error: `unknown kind ${String(request.agentKind)}`,
        };
      }

      const nhiEnvName = CURSOR_API_KEY_ENV_BY_AGENT[request.agentKind];

      if (request.agentKind === "coding") {
        const prUrl = request.prUrl ?? `${prUrlBase}/9001`;
        return {
          handoffId: request.handoffId,
          agentKind: "coding",
          status: "completed",
          mocked: true,
          mock,
          cloudAgentId: agentId,
          cloudRunId: runId,
          cloudAgentUrl,
          branch,
          prUrl,
          summary: formatMockNote(
            `Coding Agent pushed ${branch} and opened PR (not merged; human gate required)`,
          ),
          attempt,
          provider: {
            mode: "mock",
            autoCreatePR: true,
            autoMerge: false,
            nhiEnvName,
            nhiAgentKind: "coding",
          },
        };
      }

      if (request.agentKind === "testing") {
        return {
          handoffId: request.handoffId,
          agentKind: "testing",
          status: "completed",
          mocked: true,
          mock,
          cloudAgentId: agentId,
          cloudRunId: runId,
          cloudAgentUrl,
          branch,
          testsPassed: true,
          summary: formatMockNote(
            `Testing Agent verified ${branch}; npm test passed (fabricated)`,
          ),
          attempt,
          provider: { mode: "mock", testsPassed: true, nhiEnvName, nhiAgentKind: "testing" },
        };
      }

      // review
      return {
        handoffId: request.handoffId,
        agentKind: "review",
        status: "completed",
        mocked: true,
        mock,
        cloudAgentId: agentId,
        cloudRunId: runId,
        cloudAgentUrl,
        branch,
        prUrl: request.prUrl,
        summary: formatMockNote(
          `Review Agent recorded comments for ${request.prUrl ?? branch}; merge not approved`,
        ),
        attempt,
        provider: {
          mode: "mock",
          mergeApproved: false,
          humanGateRequired: true,
          nhiEnvName,
          nhiAgentKind: "review",
        },
      };
    },
  };
}

function mockOrchestrationResult(
  request: CloudAgentDispatchRequest,
  ctx: {
    mock: ReturnType<typeof createMockMeta>;
    agentId: string;
    runId: string;
    cloudAgentUrl: string;
    branch: string;
    attempt: number;
  },
): CloudAgentDispatchResult {
  const kind = request.agentKind as OrchestrationCloudAgentKind;
  const roleLabel: Record<OrchestrationCloudAgentKind, string> = {
    lead: "Lead",
    change_analyst: "Change Analyst",
    standards: "Standards",
    security: "Security",
    builder: "Builder",
    ai_red_teaming: "AI Red Teaming",
  };

  return {
    handoffId: request.handoffId,
    agentKind: kind,
    status: "completed",
    mocked: true,
    mock: ctx.mock,
    cloudAgentId: ctx.agentId,
    cloudRunId: ctx.runId,
    cloudAgentUrl: ctx.cloudAgentUrl,
    branch: ctx.branch,
    summary: formatMockNote(
      `${roleLabel[kind]} Cloud Agent accepted ephemeral dispatch` +
        (request.sharedContext?.storeUri
          ? `; shared store ${request.sharedContext.storeUri}`
          : ""),
    ),
    attempt: ctx.attempt,
    provider: {
      mode: "mock",
      ephemeral: true,
      orchestration: true,
      autoMerge: false,
      sharedContext: request.sharedContext ?? null,
      nhiEnvName: CURSOR_API_KEY_ENV_BY_AGENT[kind],
      nhiAgentKind: kind,
      // Caller (Desk / Lead) executes local orchestration for MOCK; this
      // dispatch only allocates cloud-agent identity + audit metadata.
      execution: "caller_local_mock",
    },
  };
}
