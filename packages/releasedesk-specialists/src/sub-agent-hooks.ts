import { nowIso, type FailureInfo, type SubAgentAggregate, type SubAgentHooks } from "@releasedesk/core";
import type { AgentRunResult } from "@releasedesk/lead";
import type { SubAgentRunnerHooks } from "./options.js";

/** Adapt runner options into the core delegation hook (tests only in practice). */
export function subAgentHooks<TContext>(
  hooks: SubAgentRunnerHooks | undefined,
): SubAgentHooks<TContext> | undefined {
  if (!hooks) return undefined;
  return {
    ...(hooks.timeoutMs !== undefined ? { timeoutMs: hooks.timeoutMs } : {}),
    ...(hooks.timeoutMsById !== undefined ? { timeoutMsById: hooks.timeoutMsById } : {}),
    ...(hooks.runOverrides
      ? {
          runOverrides: hooks.runOverrides as SubAgentHooks<TContext>["runOverrides"],
        }
      : {}),
  };
}

export function failedSubAgentResult(
  agentRole: string,
  aggregate: SubAgentAggregate,
  extraPayload: Record<string, unknown> = {},
): AgentRunResult {
  const failure: FailureInfo = {
    code: agentRole === "security" ? "security_sub_agent_failed" : "sub_agent_failed",
    message: aggregate.summary,
    retryable: true,
    failedAt: nowIso(),
  };
  return {
    status: "failed",
    summary: aggregate.summary,
    payload: {
      agentRole,
      subAgents: aggregate,
      ...extraPayload,
    },
    failure,
  };
}
