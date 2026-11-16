import type { MockMeta } from "@releasedesk/core";

/**
 * Cursor Cloud Agent kinds.
 *
 * Builder pipeline (existing): coding | testing | review
 * Orchestration (Lead + specialists as ephemeral Cloud Agents):
 *   lead | change_analyst | standards | security | builder | ai_red_teaming
 */
export type BuilderCloudAgentKind = "coding" | "testing" | "review";

export type OrchestrationCloudAgentKind =
  | "lead"
  | "change_analyst"
  | "standards"
  | "security"
  | "builder"
  | "ai_red_teaming";

export type CloudAgentKind = BuilderCloudAgentKind | OrchestrationCloudAgentKind;

export const BUILDER_CLOUD_AGENT_KINDS: readonly BuilderCloudAgentKind[] = [
  "coding",
  "testing",
  "review",
] as const;

export const ORCHESTRATION_CLOUD_AGENT_KINDS: readonly OrchestrationCloudAgentKind[] = [
  "lead",
  "change_analyst",
  "standards",
  "security",
  "builder",
  "ai_red_teaming",
] as const;

export const SPECIALIST_CLOUD_AGENT_KINDS = [
  "change_analyst",
  "standards",
  "security",
  "builder",
  "ai_red_teaming",
] as const satisfies ReadonlyArray<Exclude<OrchestrationCloudAgentKind, "lead">>;

export type SpecialistCloudAgentKind = (typeof SPECIALIST_CLOUD_AGENT_KINDS)[number];

export function isBuilderCloudAgentKind(kind: CloudAgentKind): kind is BuilderCloudAgentKind {
  return (BUILDER_CLOUD_AGENT_KINDS as readonly string[]).includes(kind);
}

export function isOrchestrationCloudAgentKind(
  kind: CloudAgentKind,
): kind is OrchestrationCloudAgentKind {
  return (ORCHESTRATION_CLOUD_AGENT_KINDS as readonly string[]).includes(kind);
}

export function isSpecialistCloudAgentKind(
  kind: CloudAgentKind,
): kind is SpecialistCloudAgentKind {
  return (SPECIALIST_CLOUD_AGENT_KINDS as readonly string[]).includes(kind);
}

export type CloudAgentClientMode = "mock" | "real";

/**
 * Pluggable Cursor Cloud Agent client.
 * MOCK: client fabricates results; real client calls api.cursor.com when credentials exist.
 */
export type CloudAgentClient = {
  readonly mode: CloudAgentClientMode;
  dispatch(request: CloudAgentDispatchRequest): Promise<CloudAgentDispatchResult>;
};

/**
 * Pointer to durable shared run context for ephemeral Cloud Agents.
 * Desk / Lead pass a file-store URI so specialists can read/write the same run.
 */
export type SharedRunContextRef = {
  /** Absolute path to FileBackedRunContextStore JSON (or other durable URI). */
  storeUri: string;
  runId?: string;
  taskId?: string;
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
  /** Shared durable run context for ephemeral orchestration agents. */
  sharedContext?: SharedRunContextRef;
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

/** One audit step recorded during Cloud Agent orchestration. */
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
