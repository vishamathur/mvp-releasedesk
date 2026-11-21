import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveGrokBotsRoot } from "./load.js";

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

export const ProcessStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.enum(["lead", "change-analyst", "standards", "security", "builder"]),
  consulting: z.array(z.string().min(1)),
  /** Null when the stage has no human approval. A string names the human role. */
  humanApprover: z.string().min(1).nullable(),
  artifacts: z.array(z.string().min(1)).min(1),
  sla: z.string().min(1),
  autoApprove: z.literal(false),
});

export const ProcessDefinitionSchema = z
  .object({
    id: z.enum(["PID-ER", "PID-NC"]),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    customerKind: z.enum(["existing", "new"]),
    cadence: z.object({
      kind: z.enum(["fixed_sprint", "kickoff_first"]),
      detail: z.string().min(1),
    }),
    entry: z.object({
      channel: z.string().min(1),
      criteria: z.array(z.string().min(1)).min(1),
    }),
    humanGates: z.array(z.string().min(1)).min(1),
    botsMayAutoApprove: z.literal(false),
    securityMandatory: z.literal(true),
    iterationGate: z.literal("red_team|security"),
    stages: z.array(ProcessStageSchema).min(1),
  })
  .strict();

export type ProcessStage = z.infer<typeof ProcessStageSchema>;
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;

export function resolveProcessesDir(workspaceRoot: string): string {
  return path.join(resolveGrokBotsRoot(workspaceRoot), "processes");
}

export async function listProcessDefinitions(
  workspaceRoot: string,
): Promise<ProcessDefinition[]> {
  const dir = resolveProcessesDir(workspaceRoot);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const defs: ProcessDefinition[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
    defs.push(ProcessDefinitionSchema.parse(raw));
  }
  return defs;
}

export function assertSharedSpine(def: ProcessDefinition): void {
  const ids = def.stages.map((s) => s.id);
  let cursor = 0;
  for (const stageId of SHARED_STAGE_IDS) {
    const at = ids.indexOf(stageId, cursor);
    if (at < 0) {
      throw new Error(`${def.id} is missing shared stage ${stageId}`);
    }
    cursor = at + 1;
  }
}
