import { z } from "zod";

/** Stages both PID-ER and PID-NC must pass, in order. */
export const SHARED_STAGE_IDS = [
  "intake",
  "estimation",
  "finance-approval",
  "security-compliance-approval",
  "build",
  "test-gate",
  "release-gate",
] as const;

/** Extra PID-NC stages, inserted after intake and before estimation. */
export const NC_PREFIX_STAGE_IDS = [
  "customer-onboarding",
  "discovery",
  "scope",
  "proposal",
] as const;

export const TEAMMATE_IDS = [
  "lead",
  "change-analyst",
  "standards",
  "security",
  "builder",
] as const;

export type TeammateId = (typeof TEAMMATE_IDS)[number];

export const SUB_AGENT_IDS = ["coding", "testing", "review"] as const;

export type SubAgentId = (typeof SUB_AGENT_IDS)[number];

export const HUMAN_GATE_IDS = [
  "proposal",
  "finance-approval",
  "security-compliance-approval",
  "release-gate",
] as const;

export type HumanGateId = (typeof HUMAN_GATE_IDS)[number];

export const THREAD_CHANNEL = "lead-chat" as const;

export const ProcessStageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.enum(TEAMMATE_IDS),
    consulting: z.array(z.enum(TEAMMATE_IDS)),
    humanApprover: z.string().min(1).nullable(),
    artifacts: z.array(z.string().min(1)).min(1),
    sla: z.string().min(1),
    autoApprove: z.literal(false),
  })
  .strict();

export const ProcessDefinitionSchema = z
  .object({
    id: z.enum(["PID-ER", "PID-NC"]),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    customerKind: z.enum(["existing", "new"]),
    cadence: z
      .object({
        kind: z.enum(["fixed_sprint", "kickoff_first"]),
        detail: z.string().min(1),
      })
      .strict(),
    entry: z
      .object({
        channel: z.literal(THREAD_CHANNEL),
        criteria: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    humanGates: z.array(z.enum(HUMAN_GATE_IDS)).min(1),
    gateRaisedBy: z.literal("stage-owner"),
    auditLog: z
      .object({
        bot: z.literal("log"),
        agentId: z.string().uuid(),
        dirEnv: z.literal("RELEASEDESK_LOG_DIR"),
      })
      .strict(),
    botsMayAutoApprove: z.literal(false),
    securityMandatory: z.literal(true),
    iterationGate: z.literal("red_team|security"),
    stages: z.array(ProcessStageSchema).min(1),
  })
  .strict();

export type ProcessStage = z.infer<typeof ProcessStageSchema>;
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
export type ProcessId = ProcessDefinition["id"];

export function assertSharedSpine(def: ProcessDefinition): void {
  const ids = def.stages.map((stage) => stage.id);
  let cursor = 0;
  for (const stageId of SHARED_STAGE_IDS) {
    const at = ids.indexOf(stageId, cursor);
    if (at < 0) {
      throw new Error(`${def.id} is missing shared stage ${stageId}`);
    }
    cursor = at + 1;
  }
}

export function isTeammateId(value: string): value is TeammateId {
  return (TEAMMATE_IDS as readonly string[]).includes(value);
}

export function isSubAgentId(value: string): value is SubAgentId {
  return (SUB_AGENT_IDS as readonly string[]).includes(value);
}

export function isHumanActor(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (isTeammateId(normalized) || isSubAgentId(normalized)) return false;
  return true;
}

export function processById(
  processes: readonly ProcessDefinition[],
  id: ProcessId,
): ProcessDefinition {
  const found = processes.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown process ${id}`);
  return found;
}

export function stageOwner(
  process: ProcessDefinition | undefined,
  stageId: string,
): TeammateId | undefined {
  return process?.stages.find((stage) => stage.id === stageId)?.owner;
}
