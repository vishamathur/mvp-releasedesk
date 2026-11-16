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

describe("grok-api-intel (Builder exclusive key)", () => {
  it("uses RELEASEDESK_GROK_API_KEY_BUILDER and ignores shared XAI_API_KEY", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not call Grok without builder key");
    });

    const result = await classifyReleaseFindings(sample, {
      env: {
        XAI_API_KEY: "shared-must-not-be-used",
        GROK_API_KEY: "also-shared",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.mocked).toBe(true);
    expect(result.keyRole).toBe("builder");
    expect(result.text).toMatch(/^MOCK:/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls Grok with Builder key via explicit resolve path", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer builder-exclusive-key");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Themes: security, standards" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await classifyReleaseFindings(sample, {
      env: {
        RELEASEDESK_GROK_API_KEY_BUILDER: "builder-exclusive-key",
        XAI_API_KEY: "shared-ignored",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.mocked).toBe(false);
    expect(result.keyRole).toBe("builder");
    expect(result.text).toContain("security");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("extract / score / summarize fall back locally without Builder key", async () => {
    const env = { CURSOR_API_KEY: "irrelevant", XAI_API_KEY: "shared" };
    const extracted = await extractReleaseActions(sample, { env });
    const scored = await scoreReleaseRisk(sample, { env });
    const summarized = await summarizeReleaseFindings(sample, { env });

    expect(extracted.mocked).toBe(true);
    expect(scored.mocked).toBe(true);
    expect(summarized.mocked).toBe(true);
    expect(scored.text).toMatch(/high|Local score/i);
    expect(summarized.keyRole).toBe("builder");
  });

  it("can opt into Security exclusive key for intel", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer security-key");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "high — advisory correlation" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await scoreReleaseRisk(sample, {
      role: "security",
      env: {
        RELEASEDESK_GROK_API_KEY_SECURITY: "security-key",
        RELEASEDESK_GROK_API_KEY_BUILDER: "builder-unused-here",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.mocked).toBe(false);
    expect(result.keyRole).toBe("security");
    expect(result.text).toMatch(/high/i);
  });
});
