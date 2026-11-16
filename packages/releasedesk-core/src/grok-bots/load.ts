import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  GrokBotCatalogSchema,
  GrokBotDefinitionSchema,
  GrokBotRegistrySchema,
  type GrokBotCatalog,
  type GrokBotDefinition,
  type GrokBotRegistry,
} from "./types.js";

/** SpaceXAI Grok Bot roster — Lead + ≥3 specialists (CA, Standards, Security, Builder). */
export const GROK_BOT_ORDER = [
  "lead",
  "change-analyst",
  "standards",
  "security",
  "builder",
] as const;

export type GrokBotPackId = (typeof GROK_BOT_ORDER)[number];

export function resolveGrokBotsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, "grok-bots");
}

export function resolveDefinitionsDir(workspaceRoot: string): string {
  return path.join(resolveGrokBotsRoot(workspaceRoot), "definitions");
}

export async function loadGrokBotCatalog(
  workspaceRoot: string,
): Promise<GrokBotCatalog> {
  const catalogPath = path.join(resolveDefinitionsDir(workspaceRoot), "catalog.json");
  const raw = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;
  return GrokBotCatalogSchema.parse(raw);
}

export async function loadGrokBotDefinition(
  workspaceRoot: string,
  id: string,
): Promise<GrokBotDefinition> {
  const filePath = path.join(resolveDefinitionsDir(workspaceRoot), `${id}.json`);
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return GrokBotDefinitionSchema.parse(raw);
}

export async function listGrokBotDefinitions(
  workspaceRoot: string,
): Promise<GrokBotDefinition[]> {
  const catalog = await loadGrokBotCatalog(workspaceRoot);
  const defs: GrokBotDefinition[] = [];
  for (const id of catalog.bots) {
    defs.push(await loadGrokBotDefinition(workspaceRoot, id));
  }
  return defs;
}

export async function loadGrokBotRegistry(
  workspaceRoot: string,
): Promise<GrokBotRegistry> {
  const registryPath = path.join(resolveGrokBotsRoot(workspaceRoot), "registry.json");
  try {
    const raw = JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    return GrokBotRegistrySchema.parse(raw);
  } catch {
    return { version: 1, updatedAt: null, entries: [] };
  }
}

export function emptyRegistryFor(
  defs: readonly GrokBotDefinition[],
): GrokBotRegistry {
  return {
    version: 1,
    updatedAt: null,
    entries: defs.map((d) => ({
      definitionId: d.id,
      liveBotId: null,
      createdAt: null,
      status: "not_created" as const,
    })),
  };
}

/** List definition JSON filenames (without catalog) for diagnostics. */
export async function listDefinitionFiles(workspaceRoot: string): Promise<string[]> {
  const dir = resolveDefinitionsDir(workspaceRoot);
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith(".json") && f !== "catalog.json").sort();
}
