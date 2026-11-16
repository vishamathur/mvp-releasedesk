import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  GROK_API_KEY_ENV,
  listGrokBotDefinitions,
  loadGrokBotRegistry,
  type GrokBotDefinition,
  type GrokBotRegistryEntry,
} from "@releasedesk/core";

export type GrokBotPack = {
  id: string;
  displayName: string;
  label: string;
  apiKeyEnv: string;
  keyPresent: boolean;
  liveBotId: string | null;
  provisionStatus: GrokBotRegistryEntry["status"];
  definitionPath: string;
  persona: string;
  skills: Array<{ name: string; body: string }>;
  routines: Array<{ name: string; body: string }>;
  connectors: string[];
  teammates: string[];
  channels: string[];
  memoryNotes: string[];
};

function workspaceRoot(): string {
  if (process.cwd().endsWith(`${path.sep}releasedesk`) || process.cwd().endsWith("/releasedesk")) {
    return path.join(process.cwd(), "..", "..");
  }
  return process.cwd();
}

function personaText(def: GrokBotDefinition): string {
  return [
    `# ${def.displayName}`,
    "",
    `**Job:** ${def.persona.job}`,
    "",
    `**Personality:** ${def.persona.personality}`,
    "",
    "**Memory:**",
    ...def.persona.memory.map((m) => `- ${m}`),
    "",
    "**Boundaries:**",
    ...def.persona.boundaries.map((b) => `- ${b}`),
    "",
    `**API key env:** ${def.apiKeyEnv}`,
  ].join("\n");
}

function skillBody(s: GrokBotDefinition["skills"][number]): string {
  return [
    `# Skill: ${s.name}`,
    "",
    `When: ${s.whenToUse}`,
    "",
    "Steps:",
    ...s.steps.map((step, i) => `${i + 1}. ${step}`),
    "",
    `Output: ${s.output}`,
    s.requiresApproval.length
      ? `Requires approval: ${s.requiresApproval.join(", ")}`
      : "Requires approval: none",
  ].join("\n");
}

function routineBody(r: GrokBotDefinition["routines"][number]): string {
  return [
    `# Routine: ${r.name}`,
    "",
    `Trigger: ${r.trigger}`,
    "",
    "Steps:",
    ...r.steps.map((step, i) => `${i + 1}. ${step}`),
  ].join("\n");
}

/** SpaceXAI roster: Lead + CA + Standards + Security + Builder (from definitions catalog). */
export async function listGrokBotPacks(): Promise<GrokBotPack[]> {
  const root = workspaceRoot();
  let defs: GrokBotDefinition[] = [];
  try {
    defs = await listGrokBotDefinitions(root);
  } catch {
    // Fall back to markdown packs if JSON defs unavailable
    return listMarkdownFallback(root);
  }

  const registry = await loadGrokBotRegistry(root);
  const byId = new Map(registry.entries.map((e) => [e.definitionId, e]));

  return defs.map((def) => {
    const entry = byId.get(def.id);
    const keyPresent = Boolean(process.env[def.apiKeyEnv]?.trim());
    return {
      id: def.id,
      displayName: def.displayName,
      label: def.label,
      apiKeyEnv: def.apiKeyEnv,
      keyPresent,
      liveBotId: entry?.liveBotId ?? null,
      provisionStatus: entry?.status ?? "not_created",
      definitionPath: `grok-bots/definitions/${def.id}.json`,
      persona: personaText(def),
      skills: def.skills.map((s) => ({ name: s.name, body: skillBody(s) })),
      routines: def.routines.map((r) => ({ name: r.name, body: routineBody(r) })),
      connectors: def.connectors.map((c) => `${c.name} (${c.access}): ${c.purpose}`),
      teammates: def.teammates,
      channels: def.channels.map((c) => `${c.name} — ${c.purpose}`),
      memoryNotes: def.persona.memory,
    };
  });
}

async function listMarkdownFallback(root: string): Promise<GrokBotPack[]> {
  const botsRoot = path.join(root, "grok-bots", "bots");
  const order = ["lead", "change-analyst", "standards", "security", "builder"];
  let ids: string[] = [];
  try {
    ids = (await readdir(botsRoot)).filter((id) => order.includes(id));
  } catch {
    return [];
  }
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const packs: GrokBotPack[] = [];
  for (const id of ids) {
    const personaPath = path.join(botsRoot, id, "PERSONA.md");
    let persona = "";
    try {
      persona = await readFile(personaPath, "utf8");
    } catch {
      continue;
    }
    const roleKey =
      id === "change-analyst"
        ? GROK_API_KEY_ENV.change_analyst
        : id === "lead"
          ? GROK_API_KEY_ENV.lead
          : id === "standards"
            ? GROK_API_KEY_ENV.standards
            : id === "security"
              ? GROK_API_KEY_ENV.security
              : GROK_API_KEY_ENV.builder;
    packs.push({
      id,
      displayName: id,
      label: id,
      apiKeyEnv: roleKey,
      keyPresent: Boolean(process.env[roleKey]?.trim()),
      liveBotId: null,
      provisionStatus: "not_created",
      definitionPath: `grok-bots/bots/${id}/PERSONA.md`,
      persona,
      skills: await readDirMarkdown(path.join(botsRoot, id, "skills")),
      routines: await readDirMarkdown(path.join(botsRoot, id, "routines")),
      connectors: [],
      teammates: [],
      channels: [],
      memoryNotes: [],
    });
  }
  return packs;
}

async function readDirMarkdown(dir: string): Promise<Array<{ name: string; body: string }>> {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    const out: Array<{ name: string; body: string }> = [];
    for (const file of files) {
      out.push({
        name: file.replace(/\.md$/, ""),
        body: await readFile(path.join(dir, file), "utf8"),
      });
    }
    return out;
  } catch {
    return [];
  }
}
