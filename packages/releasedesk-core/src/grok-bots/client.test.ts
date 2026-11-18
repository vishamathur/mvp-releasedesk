import { describe, expect, it, vi } from "vitest";
import { createGrokBotApiClient } from "./client.js";
import type { GrokBotDefinition } from "./types.js";

const sample: GrokBotDefinition = {
  id: "security",
  role: "security",
  displayName: "Security",
  label: "Mandatory security",
  apiKeyEnv: "RELEASEDESK_GROK_API_KEY_SECURITY",
  persona: {
    job: "Mandatory review",
    personality: "Blunt",
    memory: ["blockers"],
    boundaries: ["Never auto-waive"],
  },
  skills: [
    {
      name: "security-review",
      whenToUse: "every change",
      steps: ["review"],
      requiresApproval: [],
      output: "findings",
    },
  ],
  routines: [{ name: "mandatory-every-change", trigger: "every check", steps: ["run"] }],
  connectors: [{ name: "GitHub", purpose: "read", access: "read" }],
  teammates: ["lead"],
  channels: [{ name: "#release-desk", purpose: "status" }],
  handsOffTo: ["lead"],
  mandatoryOnEveryChange: true,
  markdownPackDir: "grok-bots/bots/security",
};

describe("GrokBotApiClient", () => {
  it("skips when exclusive key missing and ignores shared XAI_API_KEY", async () => {
    const client = createGrokBotApiClient({
      env: { XAI_API_KEY: "shared", GROK_API_KEY: "shared" },
      dryRun: false,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("skipped_missing_key");
    expect(result.liveBotId).toBeNull();
    expect(result.message).toContain("RELEASEDESK_GROK_API_KEY_SECURITY");
  });

  it("dry-runs without inventing a liveBotId when key present", async () => {
    const fetchImpl = vi.fn();
    const client = createGrokBotApiClient({
      env: { RELEASEDESK_GROK_API_KEY_SECURITY: "sec-key" },
      dryRun: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("dry_run");
    expect(result.liveBotId).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records liveBotId only from API response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "bot_live_123" }), { status: 200 }),
    );
    const client = createGrokBotApiClient({
      env: { RELEASEDESK_GROK_API_KEY_SECURITY: "sec-key" },
      dryRun: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: "https://example.test/v1",
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("created");
    expect(result.liveBotId).toBe("bot_live_123");
  });

  it("refuses to invent liveBotId when response has none", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createGrokBotApiClient({
      env: { RELEASEDESK_GROK_API_KEY_SECURITY: "sec-key" },
      dryRun: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("error");
    expect(result.liveBotId).toBeNull();
  });
});
