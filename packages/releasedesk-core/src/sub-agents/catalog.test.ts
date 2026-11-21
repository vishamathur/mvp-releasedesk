import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGrokBotDefinitions } from "../grok-bots/load.js";
import { xaiAgentsCreateBody } from "../grok-bots/client.js";
import { SUB_AGENT_CATALOG } from "./catalog.js";
import type { ParentBotId } from "./schema.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const DEFINITION_PARENT: Record<string, ParentBotId> = {
  lead: "lead",
  "change-analyst": "change_analyst",
  standards: "standards",
  security: "security",
  builder: "builder",
};

describe("grok bot definitions children", () => {
  it("matches the sub-agent catalog and stays off the create-body id list", async () => {
    const defs = await listGrokBotDefinitions(workspaceRoot);
    expect(defs.map((def) => def.id)).toEqual([
      "lead",
      "change-analyst",
      "standards",
      "security",
      "builder",
    ]);

    for (const def of defs) {
      const parentId = DEFINITION_PARENT[def.id];
      expect(parentId).toBeTruthy();
      const expected = SUB_AGENT_CATALOG[parentId!].map((child) => ({
        id: child.id,
        responsibility: child.responsibility,
        parallelGroup: child.parallelGroup,
        required: child.required,
      }));
      expect(def.children).toEqual(expected);

      const body = xaiAgentsCreateBody(def);
      expect(Object.keys(body).sort()).toEqual(["instructions", "name"]);
      expect(body.instructions).toContain(expected[0]!.id);
      expect(body).not.toHaveProperty("id");
    }
  });
});
