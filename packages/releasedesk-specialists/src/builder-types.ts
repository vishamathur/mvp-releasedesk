/**
 * Cursor Cloud Agent handoff shape prepared and dispatched by Builder.
 */

export type CloudAgentHandoffStatus = "planned" | "dispatched" | "completed" | "failed";

export type CloudAgentApiMode = "not_wired" | "mock" | "real";

export type CloudAgentHandoff = {
  agentKind: "coding" | "testing" | "review";
  /** Stable handoff id for dispatch correlation. */
  handoffId: string;
  status: CloudAgentHandoffStatus;
  prompt: string;
  repository: string;
  baseBranch: string;
  proposedBranch: string;
  acceptanceCriteria: string[];
  relatedEvidenceIds: string[];
  metadata: {
    branch: string;
    testsPassed?: boolean;
    prUrl?: string;
    cloudAgentApi: CloudAgentApiMode;
    cloudAgentId?: string;
    cloudRunId?: string;
    cloudAgentUrl?: string;
    dispatchAttempt?: number;
    error?: string;
  };
};
