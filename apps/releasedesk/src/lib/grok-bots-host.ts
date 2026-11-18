import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type GrokBotPack = {
  id: string;
  persona: string;
  skills: Array<{ name: string; body: string }>;
  routines: Array<{ name: string; body: string }>;
  connectors: string[];
  teammates: string[];
  memoryNotes: string[];
};

function workspaceRoot(): string {
  if (process.cwd().endsWith(`${path.sep}releasedesk`) || process.cwd().endsWith("/releasedesk")) {
    return path.join(process.cwd(), "..", "..");
  }
  return process.cwd();
}

function botsRoot(): string {
  return path.join(workspaceRoot(), "grok-bots", "bots");
}

function extractConnectors(persona: string): string[] {
  const match = persona.match(/\*\*Connectors:\*\*\s*(.+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,|via/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

function extractTeammates(persona: string): string[] {
  const lines = persona.split("\n").filter((l) => l.trim().startsWith("-"));
  return lines.map((l) => l.replace(/^-\s*/, "").trim()).slice(0, 8);
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

export async function listGrokBotPacks(): Promise<GrokBotPack[]> {
  const root = botsRoot();
  let ids: string[] = [];
  try {
    ids = await readdir(root);
  } catch {
    return [];
  }

  const packs: GrokBotPack[] = [];
  for (const id of ids.sort()) {
    const personaPath = path.join(root, id, "PERSONA.md");
    let persona = "";
    try {
      persona = await readFile(personaPath, "utf8");
    } catch {
      continue;
    }
    const skills = await readDirMarkdown(path.join(root, id, "skills"));
    const routines = await readDirMarkdown(path.join(root, id, "routines"));
    packs.push({
      id,
      persona,
      skills,
      routines,
      connectors: extractConnectors(persona),
      teammates: extractTeammates(persona),
      memoryNotes: [
        "Last runId",
        "Pending human gates",
        "Open blockers",
        id === "lead" ? "customerId when intake used" : "Latest evidence refs",
      ],
    });
  }
  return packs;
}
