import type {
  ApprovalRecord,
  DmSession,
  FeatureSignOffRecord,
  ReleaseCheckReport,
} from "@releasedesk/lead";
import type { RunContext } from "@releasedesk/core";
import type { IterationGateDemoState } from "./iteration-gate";

/** Persisted desk report — orchestrator output plus UI overlay fields. */
export type DeskReport = {
  runId: string;
  scenarioId?: string;
  scenarioLabel?: string;
  createdAt: string;
  updatedAt: string;
  prClientMode: "mock" | "real";
  autoMerge: false;
  report: ReleaseCheckReport;
  dmSession: DmSession;
  /** Approvals applied after the run completed (terminal store runs are immutable). */
  approvalOverlay?: ApprovalRecord;
  /** Feature checklist sign-offs applied after the run completed. */
  featureSignOffOverlay?: FeatureSignOffRecord;
  /** Collapsed AI Red Team iteration gate (red_team|security hard approval). */
  iterationGate?: IterationGateDemoState;
};

export type RunListItem = {
  runId: string;
  goal: string;
  repository: string;
  readiness: string;
  status: RunContext["status"];
  scenarioId?: string;
  scenarioLabel?: string;
  createdAt: string;
  updatedAt: string;
  blockingCount: number;
  pendingApprovals: number;
  checkpointCount: number;
  prCount: number;
  mockIntegrations: boolean;
};

export type DemoScenarioId =
  | "happy-path"
  | "remediation-loop"
  | "blocked-on-security"
  | "pending-approval"
  | "iteration-approval-gate";

export type DemoScenarioMeta = {
  id: DemoScenarioId;
  title: string;
  blurb: string;
  expectedReadiness: string;
};
