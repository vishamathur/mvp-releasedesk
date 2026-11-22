import { readFile, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
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
        channel: z.enum(["#er-intake", "#new-customer"]),
        criteria: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    humanGates: z.array(z.enum(HUMAN_GATE_IDS)).min(1),
    botsMayAutoApprove: z.literal(false),
    securityMandatory: z.literal(true),
    iterationGate: z.literal("red_team|security"),
    stages: z.array(ProcessStageSchema).min(1),
  })
  .strict();

export type ProcessStage = z.infer<typeof ProcessStageSchema>;
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
export type ProcessId = ProcessDefinition["id"];

export function resolveProcessesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "grok-bots", "processes");
}

export function resolveProtocolsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "grok-bots", "protocols");
}

function parseProcess(raw: unknown): ProcessDefinition {
  return ProcessDefinitionSchema.parse(raw);
}

export function loadProcessDefinitionsSync(workspaceRoot: string): ProcessDefinition[] {
  const dir = resolveProcessesDir(workspaceRoot);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  return files.map((file) => parseProcess(JSON.parse(readFileSync(path.join(dir, file), "utf8"))));
}

export async function loadProcessDefinitions(workspaceRoot: string): Promise<ProcessDefinition[]> {
  const dir = resolveProcessesDir(workspaceRoot);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const defs: ProcessDefinition[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
    defs.push(parseProcess(raw));
  }
  return defs;
}

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
