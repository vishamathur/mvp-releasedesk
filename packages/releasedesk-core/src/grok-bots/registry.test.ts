import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { xaiAgentsCreateBody } from "./client.js";
import {
  applyCreateResultsToRegistry,
  grokBotProvisionView,
  listGrokBotDefinitions,
  loadGrokBotRegistry,
} from "./load.js";
import { GrokBotRegistrySchema } from "./types.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const APP_AGENTS = {
  lead: {
    id: "46e50097-0409-4972-9be0-6ade37563135",
    name: "Release Desk Lead",
  },
  "change-analyst": {
    id: "d68fd46b-cffd-4f58-883e-1a75657ccb99",
    name: "Change Analyst",
  },
  standards: {
    id: "a82edff2-7d5d-47f2-b8bf-fb4f503177f1",
    name: "Standards",
  },
  security: {
    id: "c325bdd3-28df-419e-9824-4ede1338afc9",
    name: "Security",
  },
  builder: {
    id: "c932bf04-d05e-4809-a5cc-64afa9fb0894",
    name: "Builder",
  },
} as const;

describe("grok-bots registry", () => {
  it("records each bot as a Grok Bot app teammate, not an xAI agent", async () => {
    const registry = await loadGrokBotRegistry(workspaceRoot);
    expect(registry.entries.map((e) => e.definitionId)).toEqual([
      "lead",
      "change-analyst",
      "standards",
      "security",
      "builder",
    ]);
    for (const entry of registry.entries) {
      const expected = APP_AGENTS[entry.definitionId as keyof typeof APP_AGENTS];
      expect(entry.host).toBe("grok-bot-app");
      expect(entry.status).toBe("created_in_grok_bot_app");
      expect(entry.grokBotAppAgentId).toBe(expected.id);
      expect(entry.grokBotAppName).toBe(expected.name);
      expect(entry.liveBotId).toBeNull();
      expect(entry.lastError ?? null).toBeNull();
      const view = grokBotProvisionView(entry);
      expect(view.created).toBe(true);
      expect(view.provisionLabel).toBe("created");
      expect(view.liveBotId).toBeNull();
      expect(view.host).toBe("grok-bot-app");
    }
  });

  it("rejects storing a Grok Bot app agent id as liveBotId", () => {
    const parsed = GrokBotRegistrySchema.safeParse({
      version: 1,
      updatedAt: null,
      entries: [
        {
          definitionId: "security",
          host: "grok-bot-app",
          grokBotAppAgentId: APP_AGENTS.security.id,
          liveBotId: APP_AGENTS.security.id,
          createdAt: "2026-11-18T00:00:00.000Z",
          status: "created_in_grok_bot_app",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps app teammates when an xAI create attempt returns their app id", () => {
    const existing = GrokBotRegistrySchema.parse({
      version: 1,
      updatedAt: "2026-11-18T00:00:00.000Z",
      note: "keep me",
      entries: [
        {
          definitionId: "security",
          host: "grok-bot-app",
          grokBotAppAgentId: APP_AGENTS.security.id,
          grokBotAppName: "Security",
          liveBotId: null,
          createdAt: "2026-11-18T00:00:00.000Z",
          lastError: null,
          status: "created_in_grok_bot_app",
        },
      ],
    });
    const next = applyCreateResultsToRegistry(
      existing,
      ["security"],
      [
        {
          definitionId: "security",
          liveBotId: APP_AGENTS.security.id,
          status: "created",
          message: "should not replace the app teammate",
        },
      ],
      "2026-11-18T07:12:00.000Z",
    );
    expect(next.note).toBe("keep me");
    expect(next.entries[0]).toMatchObject({
      host: "grok-bot-app",
      status: "created_in_grok_bot_app",
      grokBotAppAgentId: APP_AGENTS.security.id,
      liveBotId: null,
      lastError: null,
    });
  });

  it("builds xAI instructions without per-bot keys or app agent ids", async () => {
    const defs = await listGrokBotDefinitions(workspaceRoot);
    for (const def of defs) {
      expect(def.mayAutoApproveHumanGate).toBe(false);
      const body = xaiAgentsCreateBody(def);
      expect(Object.keys(body).sort()).toEqual(["instructions", "name"]);
      expect(JSON.stringify(body)).not.toContain("RELEASEDESK_GROK_API_KEY_");
      for (const agent of Object.values(APP_AGENTS)) {
        expect(JSON.stringify(body)).not.toContain(agent.id);
      }
    }
  });
});
