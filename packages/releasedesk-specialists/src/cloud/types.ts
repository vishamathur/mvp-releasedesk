import type { MockMeta } from "@releasedesk/core";

/** Cursor Cloud Agent kinds under Builder. */
export type CloudAgentKind = "coding" | "testing" | "review";

export type CloudAgentClientMode = "mock" | "real";

/**
 * Cursor Cloud Agent client.
 * The shipped client is real and calls api.cursor.com. A missing exclusive key throws.
 */
export type CloudAgentClient = {
  readonly mode: CloudAgentClientMode;
  dispatch(request: CloudAgentDispatchRequest): Promise<CloudAgentDispatchResult>;
};

export type CloudAgentDispatchRequest = {
  handoffId: string;
  agentKind: CloudAgentKind;
  prompt: string;
  repository: string;
  baseBranch: string;
  proposedBranch: string;
  acceptanceCriteria: string[];
  /** Branch produced by Coding (Testing/Review start from here). */
  branch?: string;
  /** PR URL from Coding when present (Review may attach). */
  prUrl?: string;
  /**
   * Always false for Release Desk — Cloud Agents must not merge.
   * Present so callers cannot accidentally enable merge.
   */
  autoMerge: false;
};

export type CloudAgentDispatchResult = {
  handoffId: string;
  agentKind: CloudAgentKind;
  status: "completed" | "failed";
  mocked: boolean;
  mock?: MockMeta;
  cloudAgentId?: string;
  cloudRunId?: string;
  cloudAgentUrl?: string;
  branch?: string;
  prUrl?: string;
  testsPassed?: boolean;
  summary: string;
  attempt: number;
  error?: string;
  /** Raw provider payload fragment for evidence (safe subset). */
  provider?: Record<string, unknown>;
};

/** One audit step recorded during Builder → Cloud Agent orchestration. */
export type CloudAgentAuditEvent = {
  at: string;
  action: string;
  handoffId?: string;
  agentKind?: CloudAgentKind;
  attempt?: number;
  message: string;
  data?: Record<string, unknown>;
};

export type CloudDispatchAttempt = {
  handoffId: string;
  agentKind: CloudAgentKind;
  attempt: number;
  outcome: "completed" | "failed" | "retrying";
  error?: string;
  result?: CloudAgentDispatchResult;
};
