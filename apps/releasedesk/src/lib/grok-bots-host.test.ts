import { describe, expect, it } from "vitest";
import { listGrokBotPacks } from "./grok-bots-host";

describe("listGrokBotPacks", () => {
  it("shows every roster bot as created in the Grok Bot app", async () => {
    const packs = await listGrokBotPacks();
    expect(packs.map((p) => p.id)).toEqual([
      "lead",
      "change-analyst",
      "standards",
      "security",
      "builder",
    ]);
    for (const pack of packs) {
      expect(pack.created).toBe(true);
      expect(pack.provisionLabel).toBe("created");
      expect(pack.provisionStatus).toBe("created_in_grok_bot_app");
      expect(pack.host).toBe("grok-bot-app");
      expect(pack.grokBotAppAgentId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(pack.liveBotId).toBeNull();
      expect(pack.apiKeyEnv).toBe("none");
      expect(pack.keyPresent).toBe(false);
    }
  });
});
