import { describe, expect, it, vi } from "vitest";
import { createGrokBotApiClient } from "./client.js";
import type { GrokBotDefinition } from "./types.js";

const sample: GrokBotDefinition = {
  id: "security",
  role: "security",
  displayName: "Security",
  label: "Mandatory security",
  mayAutoApproveHumanGate: false,
  persona: {
    job: "Mandatory review",
    personality: "Blunt",
    memory: ["blockers"],
    boundaries: ["Never auto-waive"],
  },
  memoryKeys: [{ key: "pid.security.findings.{requestId}", stores: "findings" }],
  skills: [
    {
      name: "security-review",
      whenToUse: "every change",
      steps: ["review"],
      requiresApproval: [],
      output: "findings",
      playbook: "grok-bots/bots/security/skills/security-review.md",
    },
  ],
  routines: [
    {
      name: "mandatory-every-change",
      trigger: "every check",
      prompt: "Review and do not approve.",
      steps: ["run"],
      playbook: "grok-bots/bots/security/routines/mandatory-every-change.md",
    },
  ],
  connectors: [{ name: "GitHub", purpose: "read", access: "read" }],
  teammates: ["lead"],
  channels: [{ name: "#release-desk", purpose: "status", posts: true, listens: true }],
  handsOffTo: ["lead"],
  handoffs: [{ to: "lead", when: "findings ready", messageKind: "stage-return" }],
  mandatoryOnEveryChange: true,
  markdownPackDir: "grok-bots/bots/security",
};

describe("GrokBotApiClient", () => {
  it("skips when the app key is missing and ignores per-bot keys", async () => {
    const client = createGrokBotApiClient({
      env: { RELEASEDESK_GROK_API_KEY_SECURITY: "per-bot", GROK_API_KEY: "alias" },
      dryRun: false,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("skipped_missing_key");
    expect(result.liveBotId).toBeNull();
    expect(result.keyEnv).toBe("XAI_API_KEY");
    expect(result.message).toContain("XAI_API_KEY");
  });

  it("dry-runs without inventing a liveBotId when the app key is present", async () => {
    const fetchImpl = vi.fn();
    const client = createGrokBotApiClient({
      env: { XAI_API_KEY: "app-key" },
      dryRun: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("dry_run");
    expect(result.liveBotId).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs /agents with name+instructions and records liveBotId from response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "bot_live_123" }), { status: 200 }),
    );
    const client = createGrokBotApiClient({
      env: { XAI_API_KEY: "app-key" },
      dryRun: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: "https://example.test/v1",
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("created");
    expect(result.liveBotId).toBe("bot_live_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/agents");
    const body = JSON.parse(String(init.body)) as { name: string; instructions: string };
    expect(Object.keys(body).sort()).toEqual(["instructions", "name"]);
    expect(body.name).toBe("Security");
    expect(body.instructions).toContain("Mandatory review");
    expect(body).not.toHaveProperty("description");
    expect(JSON.stringify(body)).not.toContain("c325bdd3-28df-419e-9824-4ede1338afc9");
  });

  it("does not post a Grok Bot app agent id even when that id is in the environment", async () => {
    const appAgentId = "c325bdd3-28df-419e-9824-4ede1338afc9";
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "agt_from_xai" }), { status: 200 }),
    );
    const client = createGrokBotApiClient({
      env: {
        GROK_BOT_APP_AGENT_ID: appAgentId,
        XAI_API_KEY: "app-key",
      },
      dryRun: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: "https://example.test/v1",
    });
    const result = await client.createBot(sample);
    expect(result.liveBotId).toBe("agt_from_xai");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("grokBotAppAgentId");
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("agent_id");
    expect(JSON.stringify(body)).not.toContain(appAgentId);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer app-key");
  });

  it("refuses to invent liveBotId when response has none", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createGrokBotApiClient({
      env: { XAI_API_KEY: "app-key" },
      dryRun: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.createBot(sample);
    expect(result.status).toBe("error");
    expect(result.liveBotId).toBeNull();
  });
});
