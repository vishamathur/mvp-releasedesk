import type {
  CreateEvidenceInput,
  FailureInfo,
  MockMeta,
  RunContext,
  TaskRecord,
} from "@releasedesk/core";
import { SPECIALIST_ROLES } from "@releasedesk/core";

/** Specialist roles the Lead may dispatch (excludes `lead`). */
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

export type AgentRunInvocation = {
  runId: string;
  taskId: string;
  agentRole: SpecialistRole;
  attempt: number;
  run: RunContext;
  task: TaskRecord;
};

/**
 * Result returned by a pluggable specialist runner.
 * The Lead records evidence / complete / fail on the shared run context —
 * runners must not mutate the store themselves.
 */
export type AgentRunResult = {
  status: "completed" | "failed" | "retrying";
  summary: string;
  /** Role-specific structured fields (merged into task.output / contract validation). */
  payload: Record<string, unknown>;
  evidence?: CreateEvidenceInput[];
  failure?: FailureInfo;
  mocksUsed?: MockMeta[];
};

/** Pluggable specialist execution — real agents (M4) or MOCK stubs (M3). */
export type AgentRunner = (invocation: AgentRunInvocation) => Promise<AgentRunResult>;

export type AgentRunnerMap = Partial<Record<SpecialistRole, AgentRunner>>;

export function isSpecialistRole(role: string): role is SpecialistRole {
  return (SPECIALIST_ROLES as readonly string[]).includes(role);
}
