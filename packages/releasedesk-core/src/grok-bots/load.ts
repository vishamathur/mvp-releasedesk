import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  GrokBotCatalogSchema,
  GrokBotDefinitionSchema,
  GrokBotRegistrySchema,
  type GrokBotCatalog,
  type GrokBotDefinition,
  type GrokBotProvisionHost,
  type GrokBotRegistry,
  type GrokBotRegistryEntry,
  type GrokBotRegistryStatus,
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
    entries: defs.map((d) => blankRegistryEntry(d.id)),
  };
}

export function blankRegistryEntry(definitionId: string): GrokBotRegistryEntry {
  return {
    definitionId,
    liveBotId: null,
    grokBotAppAgentId: null,
    grokBotAppName: null,
    host: "none",
    createdAt: null,
    lastError: null,
    status: "not_created",
  };
}

/** True when this entry is a Grok Bot app teammate, not an xAI Agents API agent. */
export function isGrokBotAppRegistryEntry(
  entry: GrokBotRegistryEntry | undefined,
): entry is GrokBotRegistryEntry & {
  host: "grok-bot-app";
  status: "created_in_grok_bot_app";
  grokBotAppAgentId: string;
} {
  return Boolean(
    entry &&
      entry.host === "grok-bot-app" &&
      entry.status === "created_in_grok_bot_app" &&
      entry.grokBotAppAgentId,
  );
}

export type GrokBotProvisionLabel = "created" | "not created" | "key missing" | "error";

export type GrokBotProvisionView = {
  host: GrokBotProvisionHost;
  liveBotId: string | null;
  grokBotAppAgentId: string | null;
  grokBotAppName: string | null;
  status: GrokBotRegistryStatus;
  provisionLabel: GrokBotProvisionLabel;
  created: boolean;
};

/**
 * Desk-facing view of one registry row.
 * App agent ids are never reported as xAI `liveBotId`s.
 */
export function grokBotProvisionView(
  entry: GrokBotRegistryEntry | undefined,
): GrokBotProvisionView {
  const status = entry?.status ?? "not_created";
  const host = entry?.host ?? "none";
  const grokBotAppAgentId = entry?.grokBotAppAgentId ?? null;
  const appCreated = isGrokBotAppRegistryEntry(entry);
  const xaiCreated = status === "created" && host === "xai-agents-api" && Boolean(entry?.liveBotId);
  const liveBotId = appCreated ? null : (entry?.liveBotId ?? null);
  const created = appCreated || xaiCreated;
  const provisionLabel: GrokBotProvisionLabel = created
    ? "created"
    : status === "skipped_missing_key"
      ? "key missing"
      : status === "error"
        ? "error"
        : "not created";
  return {
    host: appCreated ? "grok-bot-app" : host,
    liveBotId,
    grokBotAppAgentId,
    grokBotAppName: entry?.grokBotAppName ?? null,
    status,
    provisionLabel,
    created,
  };
}

export type GrokBotCreateAttemptStatus =
  | "created"
  | "skipped_missing_key"
  | "error"
  | "dry_run"
  | "preserved_grok_bot_app";

export type GrokBotCreateAttempt = {
  definitionId: string;
  liveBotId: string | null;
  status: GrokBotCreateAttemptStatus;
  message: string;
};

/**
 * Merge an xAI create attempt into the registry.
 * Rows already created in the Grok Bot app are preserved and never receive
 * their app agent id as `liveBotId`.
 */
export function applyCreateResultsToRegistry(
  existing: GrokBotRegistry | null,
  definitionIds: readonly string[],
  results: readonly GrokBotCreateAttempt[],
  nowIso: string,
): GrokBotRegistry {
  const prevById = new Map((existing?.entries ?? []).map((e) => [e.definitionId, e]));
  const resultById = new Map(results.map((r) => [r.definitionId, r]));

  const entries = definitionIds.map((definitionId) => {
    const prev = prevById.get(definitionId);
    if (isGrokBotAppRegistryEntry(prev)) {
      return {
        definitionId,
        liveBotId: null,
        grokBotAppAgentId: prev.grokBotAppAgentId,
        grokBotAppName: prev.grokBotAppName ?? null,
        host: "grok-bot-app" as const,
        createdAt: prev.createdAt,
        lastError: null,
        status: "created_in_grok_bot_app" as const,
      };
    }

    const attempt = resultById.get(definitionId);
    if (!attempt || attempt.status === "dry_run" || attempt.status === "preserved_grok_bot_app") {
      return prev ?? blankRegistryEntry(definitionId);
    }

    if (attempt.status === "created" && attempt.liveBotId) {
      if (prev?.grokBotAppAgentId && attempt.liveBotId === prev.grokBotAppAgentId) {
        return {
          ...(prev ?? blankRegistryEntry(definitionId)),
          definitionId,
          liveBotId: null,
          lastError:
            "Refused to record Grok Bot app agent id as an xAI Agents API liveBotId",
          status: "error" as const,
        };
      }
      return {
        definitionId,
        liveBotId: attempt.liveBotId,
        grokBotAppAgentId: prev?.grokBotAppAgentId ?? null,
        grokBotAppName: prev?.grokBotAppName ?? null,
        host: "xai-agents-api" as const,
        createdAt: nowIso,
        lastError: null,
        status: "created" as const,
      };
    }

    return {
      definitionId,
      liveBotId: null,
      grokBotAppAgentId: prev?.grokBotAppAgentId ?? null,
      grokBotAppName: prev?.grokBotAppName ?? null,
      host: "none" as const,
      createdAt: null,
      lastError: attempt.status === "error" ? attempt.message : null,
      status: attempt.status === "skipped_missing_key" ? ("skipped_missing_key" as const) : ("error" as const),
    };
  });

  const extras = (existing?.entries ?? []).filter(
    (entry) => !definitionIds.includes(entry.definitionId) && isGrokBotAppRegistryEntry(entry),
  );

  return {
    version: 1,
    updatedAt: nowIso,
    ...(existing?.note ? { note: existing.note } : {}),
    entries: [...entries, ...extras],
  };
}

/** List definition JSON filenames (without catalog) for diagnostics. */
export async function listDefinitionFiles(workspaceRoot: string): Promise<string[]> {
  const dir = resolveDefinitionsDir(workspaceRoot);
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith(".json") && f !== "catalog.json").sort();
}
