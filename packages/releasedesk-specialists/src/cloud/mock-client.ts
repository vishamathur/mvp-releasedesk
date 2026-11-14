import { createMockMeta, formatMockNote } from "@releasedesk/core";
import type {
  CloudAgentClient,
  CloudAgentDispatchRequest,
  CloudAgentDispatchResult,
} from "./types.js";

export type MockCloudAgentClientOptions = {
  /**
   * Force failures for specific agent kinds (tests).
   * Attempt numbers are 1-based; fails while attempt <= failUntilAttempt.
   */
  failUntilAttempt?: Partial<Record<CloudAgentDispatchRequest["agentKind"], number>>;
  /** Override fabricated PR URL host path. */
  prUrlBase?: string;
};

/**
 * MOCK: Cursor Cloud Agent client — same interface as the real client.
 * Fabricates branch / test / PR metadata without calling Cursor APIs.
 * Labeled with `MOCK:` / `mocked: true` so CI never needs live credentials.
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
          provider: { mode: "mock", testsPassed: true },
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
        },
      };
    },
  };
}
