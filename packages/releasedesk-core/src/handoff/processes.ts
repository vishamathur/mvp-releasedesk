import { readFile, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ProcessDefinitionSchema, type ProcessDefinition } from "./process-defs.js";

export {
  SHARED_STAGE_IDS,
  NC_PREFIX_STAGE_IDS,
  TEAMMATE_IDS,
  SUB_AGENT_IDS,
  HUMAN_GATE_IDS,
  THREAD_CHANNEL,
  ProcessStageSchema,
  ProcessDefinitionSchema,
  assertSharedSpine,
  isTeammateId,
  isSubAgentId,
  isHumanActor,
  processById,
  stageOwner,
  type ProcessStage,
  type ProcessDefinition,
  type ProcessId,
  type TeammateId,
  type SubAgentId,
  type HumanGateId,
} from "./process-defs.js";

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
