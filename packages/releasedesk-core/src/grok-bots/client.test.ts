import { describe, expect, it, vi } from "vitest";
import { triggerGrokBot } from "./client.js";

describe("triggerGrokBot", () => {
  it("MOCK when no webhook and no exclusive key; ignores shared XAI_API_KEY", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerGrokBot(
      { botId: "lead", payload: { customerId: "northwind" } },
      {
        env: { XAI_API_KEY: "shared-must-not-win" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(result.mocked).toBe(true);
    expect(result.mode).toBe("mock");
    expect(result.definitionPath).toContain("lead");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses exclusive Lead key for xai_chat fallback", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer lead-only");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Lead: check started" } }] }),
        { status: 200 },
      );
    });
    const result = await triggerGrokBot(
      { botId: "lead" },
      {
        env: {
          RELEASEDESK_GROK_API_KEY_LEAD: "lead-only",
          XAI_API_KEY: "shared",
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(result.mode).toBe("xai_chat");
    expect(result.mocked).toBe(false);
    expect(result.summary).toContain("check started");
  });

  it("prefers webhook when URL+key present", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://hooks.example/lead");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer whsec");
      return new Response("ok", { status: 200 });
    });
    const result = await triggerGrokBot(
      { botId: "security" },
      {
        env: {
          RELEASEDESK_GROK_BOT_WEBHOOK_URL_SECURITY: "https://hooks.example/lead",
          RELEASEDESK_GROK_BOT_WEBHOOK_KEY_SECURITY: "whsec",
          RELEASEDESK_GROK_API_KEY_SECURITY: "unused-when-webhook",
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(result.mode).toBe("webhook");
    expect(result.ok).toBe(true);
    expect(result.mocked).toBe(false);
  });
});
