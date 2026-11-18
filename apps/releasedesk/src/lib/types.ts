import type {
  ApprovalRecord,
  DmSession,
  ReleaseCheckReport,
} from "@releasedesk/lead";
import type { RunContext } from "@releasedesk/core";

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
  | "pending-approval";

export type DemoScenarioMeta = {
  id: DemoScenarioId;
  title: string;
  blurb: string;
  expectedReadiness: string;
};
