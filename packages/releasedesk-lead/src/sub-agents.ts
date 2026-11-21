import {
  bindChild,
  delegateToChildren,
  type SubAgentAggregate,
  type SubAgentChildRun,
  type SubAgentHooks,
} from "@releasedesk/core";

export type LeadTrack = "er_sprint" | "new_customer_kickoff";

export type LeadReleaseSnapshot = {
  delegationCount: number;
  securityScheduled: boolean;
  readiness: string;
  blockingIssueCount: number;
};

export type LeadSubAgentContext = {
  goal: string;
  repository: string;
  baseRef: string;
  headRef: string;
  metadata: Record<string, unknown>;
  release?: LeadReleaseSnapshot;
};

export type LeadSubAgentHooks = {
  timeoutMs?: number;
  timeoutMsById?: Record<string, number>;
  runOverrides?: Record<string, SubAgentChildRun<LeadSubAgentContext>>;
};

function hooksFor(hooks: LeadSubAgentHooks | undefined): SubAgentHooks<LeadSubAgentContext> | undefined {
  if (!hooks) return undefined;
  return {
    ...(hooks.timeoutMs !== undefined ? { timeoutMs: hooks.timeoutMs } : {}),
    ...(hooks.timeoutMsById !== undefined ? { timeoutMsById: hooks.timeoutMsById } : {}),
    ...(hooks.runOverrides ? { runOverrides: hooks.runOverrides } : {}),
  };
}

export function readLeadTrack(metadata: Record<string, unknown> | undefined): LeadTrack {
  const raw = metadata?.track ?? metadata?.customerTrack;
  if (raw === "new_customer_kickoff" || raw === "kickoff") return "new_customer_kickoff";
  return "er_sprint";
}

/**
 * Lead's own children. Specialists stay a separate delegation.
 * Front phase (routing, then kickoff) runs before the sprint.
 * Aggregation runs after specialists and does not approve gates.
 */
export async function delegateLeadChildren(args: {
  phase: "front" | "aggregation";
  context: LeadSubAgentContext;
  hooks?: LeadSubAgentHooks;
}): Promise<SubAgentAggregate> {
  const hooks = hooksFor(args.hooks);
  const front = [
    bindChild(
      "lead",
      "lead.intake-routing",
      async (ctx) => {
        const track = readLeadTrack(ctx.metadata);
        const customerId = typeof ctx.metadata.customerId === "string" ? ctx.metadata.customerId : null;
        return {
          summary: `Routed ${ctx.repository} onto ${track}`,
          payload: {
            track,
            repository: ctx.repository,
            goal: ctx.goal,
            customerId,
          },
        };
      },
      hooks,
    ),
    bindChild(
      "lead",
      "lead.kickoff",
      async (ctx, prior) => {
        const routed = prior.find((child) => child.id === "lead.intake-routing");
        const track = routed?.payload.track === "new_customer_kickoff" ? "new_customer_kickoff" : "er_sprint";
        if (track === "er_sprint") {
          return {
            summary: "ER sprint item is already scoped; kickoff proposal not opened.",
            payload: {
              applied: false,
              track,
              humanApprovalRequired: false,
              approved: false,
              feedsSprint: true,
            },
          };
        }
        return {
          summary: "Kickoff proposal ready for human approval; sprint is not auto-approved.",
          payload: {
            applied: true,
            track,
            discovery: `New customer work for ${ctx.repository}: ${ctx.goal}`,
            scope: `Repository ${ctx.repository} (${ctx.baseRef}...${ctx.headRef}). Goal: ${ctx.goal}`,
            proposal: `Propose a release-check sprint for ${ctx.repository}. A human must approve merge and release.`,
            humanApprovalRequired: true,
            approved: false,
            feedsSprint: true,
          },
        };
      },
      hooks,
    ),
  ];

  const aggregation = [
    bindChild(
      "lead",
      "lead.release-aggregation",
      async (ctx) => {
        const release = ctx.release;
        const delegationCount = release?.delegationCount ?? 0;
        const readiness = release?.readiness ?? "unknown";
        return {
          summary: `Aggregated ${delegationCount} specialist delegation(s); readiness ${readiness}. Iteration gate stays with humans.`,
          payload: {
            delegationCount,
            securityScheduled: release?.securityScheduled ?? false,
            readiness,
            blockingIssueCount: release?.blockingIssueCount ?? 0,
            iterationGate: "red_team|security",
            autoApproved: false,
          },
        };
      },
      hooks,
    ),
  ];

  return delegateToChildren({
    parentId: "lead",
    context: args.context,
    children: args.phase === "front" ? front : aggregation,
  });
}
