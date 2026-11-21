import { describe, expect, it, vi } from "vitest";
import {
  classifyReleaseFindings,
  extractReleaseActions,
  scoreReleaseRisk,
  summarizeReleaseFindings,
} from "./grok-api-intel.js";

const sample = [
  {
    id: "f1",
    sourceAgent: "security",
    summary: "CVE-2024-0001 affects lodash in workspace",
    severity: "high",
  },
  {
    id: "f2",
    sourceAgent: "standards",
    summary: "Retention label missing on KYC export path",
    severity: "medium",
  },
];

describe("grok-api-intel (app key)", () => {
  it("stays MOCK when only per-bot keys are set", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not call Grok without the app key");
    });

    const result = await classifyReleaseFindings(sample, {
      env: {
        RELEASEDESK_GROK_API_KEY_BUILDER: "per-bot",
        GROK_API_KEY: "alias",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.mocked).toBe(true);
    expect(result.keyRole).toBe("app");
    expect(result.keyEnv).toBe("XAI_API_KEY");
    expect(result.text).toMatch(/^MOCK:/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Grok with XAI_API_KEY and json_schema", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer app-key");
      const body = JSON.parse(String(init?.body)) as {
        response_format?: { type?: string; json_schema?: { name?: string } };
      };
      expect(body.response_format?.type).toBe("json_schema");
      expect(body.response_format?.json_schema?.name).toBe("release_intel_line");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Themes: security, standards" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await classifyReleaseFindings(sample, {
      env: {
        XAI_API_KEY: "app-key",
        RELEASEDESK_GROK_API_KEY_BUILDER: "per-bot-ignored",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.mocked).toBe(false);
    expect(result.keyRole).toBe("app");
    expect(result.text).toContain("security");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("extract / score / summarize fall back locally without the app key", async () => {
    const env = { CURSOR_API_KEY: "irrelevant", RELEASEDESK_GROK_API_KEY_BUILDER: "ignored" };
    const extracted = await extractReleaseActions(sample, { env });
    const scored = await scoreReleaseRisk(sample, { env });
    const summarized = await summarizeReleaseFindings(sample, { env });

    expect(extracted.mocked).toBe(true);
    expect(scored.mocked).toBe(true);
    expect(summarized.mocked).toBe(true);
    expect(scored.text).toMatch(/high|Local score/i);
    expect(summarized.keyRole).toBe("app");
  });
});
