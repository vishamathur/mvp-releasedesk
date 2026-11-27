import { describe, expect, it } from "vitest";
import {
  BILLED_COST_NOT_REPORTED,
  billedUsdFromTicks,
  buildGrokTelemetry,
  estimateGrokCostUsd,
  formatGrokTelemetryLine,
  lookupGrokPrice,
  readGrokServedModel,
  readGrokUsage,
  USD_TICKS_PER_DOLLAR,
} from "./grok-telemetry.js";

describe("readGrokUsage", () => {
  it("reads prompt, completion, total and reasoning tokens", () => {
    expect(
      readGrokUsage({
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          total_tokens: 1500,
          completion_tokens_details: { reasoning_tokens: 40 },
        },
      }),
    ).toEqual({
      promptTokens: 1200,
      completionTokens: 300,
      reasoningTokens: 40,
      totalTokens: 1500,
      cachedPromptTokens: null,
      costInUsdTicks: null,
    });
  });

  it("reads billed ticks and cached prompt tokens, and does not invent either", () => {
    expect(
      readGrokUsage({
        usage: {
          prompt_tokens: 199,
          completion_tokens: 1,
          total_tokens: 200,
          cost_in_usd_ticks: 37_756_000,
          prompt_tokens_details: { cached_tokens: 128 },
        },
      }),
    ).toMatchObject({ costInUsdTicks: 37_756_000, cachedPromptTokens: 128 });

    expect(
      readGrokUsage({
        usage: { input_tokens_details: { cached_tokens: 98 }, cost_in_usd_ticks: 0 },
      }).cachedPromptTokens,
    ).toBe(98);
    expect(readGrokUsage({ usage: { cost_in_usd_ticks: 0 } }).costInUsdTicks).toBe(0);
    expect(readGrokUsage({ usage: { cost_in_usd_ticks: "37756000" } }).costInUsdTicks).toBeNull();
    expect(readGrokUsage({ usage: { prompt_tokens_details: { cached_tokens: -1 } } }).cachedPromptTokens).toBeNull();
  });

  it("leaves everything null when usage is missing or malformed, and does not invent numbers", () => {
    const empty = {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      cachedPromptTokens: null,
      costInUsdTicks: null,
    };
    expect(readGrokUsage({})).toEqual(empty);
    expect(readGrokUsage(null)).toEqual(empty);
    expect(readGrokUsage({ usage: { prompt_tokens: "12", completion_tokens: -1 } })).toEqual(empty);
  });
});

describe("billedUsdFromTicks", () => {
  it("converts ticks at 10^10 per USD and treats 0 as a real bill", () => {
    expect(USD_TICKS_PER_DOLLAR).toBe(10_000_000_000);
    expect(billedUsdFromTicks(37_756_000)).toBeCloseTo(0.0037756, 10);
    expect(billedUsdFromTicks(400_000_000)).toBeCloseTo(0.04, 10);
    expect(billedUsdFromTicks(0)).toBe(0);
  });
});

describe("readGrokServedModel", () => {
  it("returns the reported model or null", () => {
    expect(readGrokServedModel({ model: " grok-4.3 " })).toBe("grok-4.3");
    expect(readGrokServedModel({})).toBeNull();
    expect(readGrokServedModel({ model: "" })).toBeNull();
  });
});

describe("estimateGrokCostUsd", () => {
  it("prices grok-4.3 at $1.25 in / $2.50 out per 1M tokens", () => {
    const r = estimateGrokCostUsd("grok-4.3", {
      promptTokens: 100_000,
      completionTokens: 100_000,
      reasoningTokens: null,
      totalTokens: 200_000,
    });
    expect(r.estUsd).toBeCloseTo(0.375, 6);
    expect(r.note).toMatch(/estimate/);
    expect(r.note).toMatch(/not a bill/);
  });

  it("counts reasoning tokens when total_tokens exceeds prompt + completion", () => {
    const r = estimateGrokCostUsd("grok-4.3", {
      promptTokens: 1000,
      completionTokens: 100,
      reasoningTokens: 400,
      totalTokens: 1500,
    });
    // output = max(100, 1500 - 1000) = 500
    expect(r.estUsd).toBeCloseTo((1000 * 1.25 + 500 * 2.5) / 1_000_000, 8);
  });

  it("uses the long-context rate at 200k prompt tokens", () => {
    const r = estimateGrokCostUsd("grok-4.7", {
      promptTokens: 200_000,
      completionTokens: 1000,
      reasoningTokens: null,
      totalTokens: 201_000,
    });
    expect(r.estUsd).toBeCloseTo((200_000 * 4 + 1000 * 12) / 1_000_000, 6);
  });

  it("is null, with a reason, when usage is missing or the model has no listed price", () => {
    const none = { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null };
    expect(estimateGrokCostUsd("grok-4.3", none)).toEqual({ estUsd: null, note: "usage not reported by the API" });
    const used = { promptTokens: 10, completionTokens: 5, reasoningTokens: null, totalTokens: 15 };
    const r = estimateGrokCostUsd("grok-mystery", used);
    expect(r.estUsd).toBeNull();
    expect(r.note).toMatch(/no price listed for grok-mystery/);
  });
});

describe("lookupGrokPrice", () => {
  it("matches a dated variant of a listed slug but not a different model", () => {
    expect(lookupGrokPrice("grok-4.3-0415")).toBe(lookupGrokPrice("grok-4.3"));
    expect(lookupGrokPrice("grok-4.20-0309-non-reasoning")).not.toBeNull();
    expect(lookupGrokPrice("grok-3")).toBeNull();
    expect(lookupGrokPrice("grok-4.30")).toBeNull();
  });
});

describe("buildGrokTelemetry and the footer line", () => {
  it("records the served model next to the requested one", () => {
    const t = buildGrokTelemetry({
      requestedModel: "grok-4.3",
      latencyMs: 4120.4,
      body: {
        model: "grok-4.3-0415",
        usage: { prompt_tokens: 1234, completion_tokens: 321, total_tokens: 1555 },
      },
    });
    expect(t.servedModel).toBe("grok-4.3-0415");
    expect(t.requestedModel).toBe("grok-4.3");
    expect(t.latencyMs).toBe(4120);
    const line = formatGrokTelemetryLine(t);
    expect(line).toContain("grok-4.3-0415");
    expect(line).toContain("requested grok-4.3");
    expect(line).toContain("1234 prompt / 321 completion tokens");
    expect(line).toContain("4120 ms");
    expect(line).toContain(BILLED_COST_NOT_REPORTED);
    expect(line).toMatch(/est\. cost \$0\.\d+ \(estimate, not a bill\)/);
    expect(t.billedCostUsd).toBeNull();
    expect(t.cachedPromptTokens).toBeNull();
  });

  it("shows the billed cost from ticks and keeps the estimate as a separate label", () => {
    const t = buildGrokTelemetry({
      requestedModel: "grok-4.3",
      latencyMs: 800,
      body: {
        model: "grok-4.3",
        usage: {
          prompt_tokens: 199,
          completion_tokens: 1,
          total_tokens: 200,
          cost_in_usd_ticks: 37_756_000,
          prompt_tokens_details: { cached_tokens: 128 },
        },
      },
    });
    expect(t.billedCostUsd).toBeCloseTo(0.0037756, 10);
    expect(t.costInUsdTicks).toBe(37_756_000);
    expect(t.cachedPromptTokens).toBe(128);
    expect(t.estUsd).not.toBeNull();
    const line = formatGrokTelemetryLine(t);
    expect(line).toContain("billed cost $0.0038");
    expect(line).toContain("128 cached prompt tokens");
    expect(line).toMatch(/est\. cost \$0\.\d+ \(estimate, not a bill\)/);
    expect(line.indexOf("billed cost")).toBeLessThan(line.indexOf("est. cost"));
  });

  it("says plainly when the response had no model and no usage", () => {
    const line = formatGrokTelemetryLine(
      buildGrokTelemetry({ requestedModel: "grok-4.3", latencyMs: 50, body: {} }),
    );
    expect(line).toContain("response did not report a model");
    expect(line).toContain("token usage not reported");
    expect(line).toContain(BILLED_COST_NOT_REPORTED);
    expect(line).toContain("est. cost n/a (usage not reported by the API)");
  });
});
