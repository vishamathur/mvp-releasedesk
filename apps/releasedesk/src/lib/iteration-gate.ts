import {
  createZscalerMockFindings,
  nowIso,
  runCollapsedAiRedTeamGate,
  type AiRedTeamFinding,
  type AiRedTeamGateContext,
  type CollapsedAiRedTeamGateResult,
  type IterationApproval,
  type IterationApprovalKind,
} from "@releasedesk/core";

/** Desk-persisted demo state for the collapsed AI Red Team iteration gate. */
export type IterationGateDemoState = {
  iterationId: string;
  title: string;
  context: AiRedTeamGateContext;
  preReleaseFindings: AiRedTeamFinding[];
  postRemediationFindings: AiRedTeamFinding[];
  approvals: IterationApproval[];
  rejected?: { by: string; at: string; note?: string };
  updatedAt: string;
};

export type IterationGateView = {
  state: IterationGateDemoState;
  gate: CollapsedAiRedTeamGateResult;
  /** pending | open | blocked */
  uiStatus: "pending" | "open" | "blocked";
};

export function recomputeIterationGate(
  state: IterationGateDemoState,
): IterationGateView {
  const gate = runCollapsedAiRedTeamGate({
    iterationId: state.iterationId,
    context: state.context,
    preReleaseFindings: state.preReleaseFindings,
    postRemediationFindings: state.postRemediationFindings,
    approvals: state.rejected ? [] : state.approvals,
    nowIso: state.updatedAt,
    createSideQueueId: () => `sideq_${state.iterationId}`,
  });

  let uiStatus: IterationGateView["uiStatus"] = "pending";
  if (state.rejected) uiStatus = "blocked";
  else if (gate.iterationProceed.canProceed) uiStatus = "open";
  else uiStatus = "pending";

  return { state, gate, uiStatus };
}

export function createPendingIterationGateDemo(): IterationGateDemoState {
  const iterationId = `iter_demo_${Date.now().toString(36)}`;
  const findings = createZscalerMockFindings("northwind-kyc-demo").map((f) => ({
    ...f,
    releaseBlocking: true,
  }));
  return {
    iterationId,
    title: "Code iteration — AI Red Team / Security sign-off",
    context: {
      provider: "zscaler",
      mcpContext: "zscaler-mcp-red-team",
      findingsRouting: "block",
    },
    preReleaseFindings: findings.slice(0, 2),
    postRemediationFindings: findings.slice(2),
    approvals: [],
    updatedAt: nowIso(),
  };
}

export function applyIterationSignOff(
  state: IterationGateDemoState,
  input: {
    decision: "approved" | "rejected";
    kind?: IterationApprovalKind;
    decidedBy: string;
    note?: string;
  },
): IterationGateDemoState {
  const at = nowIso();
  if (input.decision === "rejected") {
    return {
      ...state,
      approvals: [],
      rejected: {
        by: input.decidedBy,
        at,
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
      updatedAt: at,
    };
  }

  const kind = input.kind ?? "red_team";
  const approval: IterationApproval = {
    iterationId: state.iterationId,
    kind,
    approvedBy: input.decidedBy,
    approvedAt: at,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  return {
    ...state,
    rejected: undefined,
    approvals: [
      ...state.approvals.filter((a) => a.kind !== kind),
      approval,
    ],
    updatedAt: at,
  };
}
