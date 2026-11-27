/**
 * Grok API call telemetry: token usage, latency, the billed cost, and an estimate.
 *
 * The billed cost is `usage.cost_in_usd_ticks` from the xAI response
 * (1 USD = 10^10 ticks; https://docs.x.ai/developers/cost-tracking).
 * When that field is absent the billed cost stays null and the footer says
 * "billed cost not reported". The price-table figure stays a separately
 * labelled estimate. Nothing here invents a billed value.
 * Cached prompt tokens are recorded only when the response includes them
 * (`usage.prompt_tokens_details.cached_tokens`, or
 * `usage.input_tokens_details.cached_tokens` on the Responses API).
 */

export const GROK_PRICE_TABLE_SOURCE = "https://docs.x.ai/developers/models";
export const GROK_PRICE_TABLE_CHECKED = "2026-11-26";
/** Requests whose prompt reaches this many tokens bill every token at the long-context rate. */
export const GROK_LONG_CONTEXT_PROMPT_TOKENS = 200_000;
/** xAI cost ticks. https://docs.x.ai/developers/cost-tracking */
export const USD_TICKS_PER_DOLLAR = 10_000_000_000;
export const BILLED_COST_NOT_REPORTED = "billed cost not reported";

export type GrokPrice = {
  /** USD per 1M input tokens below the long-context threshold. */
  inputPerMTok: number;
  /** USD per 1M output tokens below the long-context threshold. */
  outputPerMTok: number;
  longInputPerMTok: number;
  longOutputPerMTok: number;
};

/** USD per 1M tokens, from the xAI models and pricing pages. Cached-input discounts are not applied. */
export const GROK_PRICE_TABLE: Readonly<Record<string, GrokPrice>> = {
  "grok-4.7": { inputPerMTok: 2, outputPerMTok: 6, longInputPerMTok: 4, longOutputPerMTok: 12 },
  "grok-4.6": { inputPerMTok: 2, outputPerMTok: 6, longInputPerMTok: 4, longOutputPerMTok: 12 },
  "grok-4.5": { inputPerMTok: 2, outputPerMTok: 6, longInputPerMTok: 4, longOutputPerMTok: 12 },
  "grok-4.3": { inputPerMTok: 1.25, outputPerMTok: 2.5, longInputPerMTok: 2.5, longOutputPerMTok: 5 },
  "grok-4.20-0309-reasoning": { inputPerMTok: 1.25, outputPerMTok: 2.5, longInputPerMTok: 2.5, longOutputPerMTok: 5 },
  "grok-4.20-0309-non-reasoning": { inputPerMTok: 1.25, outputPerMTok: 2.5, longInputPerMTok: 2.5, longOutputPerMTok: 5 },
};

export type GrokUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  /** Cached prompt tokens, or null when the response omitted the field. */
  cachedPromptTokens: number | null;
  /** Raw `usage.cost_in_usd_ticks`, or null when the response omitted it. */
  costInUsdTicks: number | null;
};

export type GrokTelemetry = GrokUsage & {
  /** Model slug the request asked for. */
  requestedModel: string;
  /** Model slug the response reported, or null when the response had no `model`. */
  servedModel: string | null;
  latencyMs: number;
  /** Estimated USD from the public price table, or null when usage or the price is unknown. Never a bill. */
  estUsd: number | null;
  /** Why estUsd is null, or the caveat for a number. */
  estNote: string;
  /** Billed USD from `cost_in_usd_ticks`, or null when the API omitted it. */
  billedCostUsd: number | null;
  /** "billed cost not reported" when billedCostUsd is null. */
  billedNote: string;
};

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function readCachedPromptTokens(usage: Record<string, unknown> | undefined): number | null {
  if (!usage) return null;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const fromChat = intOrNull(promptDetails?.cached_tokens);
  if (fromChat !== null) return fromChat;
  const inputDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
  return intOrNull(inputDetails?.cached_tokens);
}

/** USD from integer ticks. 0 ticks is a real $0 bill, not a missing field. */
export function billedUsdFromTicks(ticks: number): number {
  return ticks / USD_TICKS_PER_DOLLAR;
}

/** Read the OpenAI-compatible `usage` object. Missing fields stay null. */
export function readGrokUsage(body: unknown): GrokUsage {
  const usage = (body as { usage?: Record<string, unknown> } | null | undefined)?.usage;
  const details = (usage as { completion_tokens_details?: Record<string, unknown> } | undefined)
    ?.completion_tokens_details;
  return {
    promptTokens: intOrNull(usage?.prompt_tokens),
    completionTokens: intOrNull(usage?.completion_tokens),
    reasoningTokens: intOrNull(details?.reasoning_tokens),
    totalTokens: intOrNull(usage?.total_tokens),
    cachedPromptTokens: readCachedPromptTokens(usage),
    costInUsdTicks: intOrNull(usage?.cost_in_usd_ticks),
  };
}

/** The model slug the response reports, or null. */
export function readGrokServedModel(body: unknown): string | null {
  const model = (body as { model?: unknown } | null | undefined)?.model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

/** Exact slug, or a dated variant such as "grok-4.3-0415" of a listed slug. */
export function lookupGrokPrice(model: string): GrokPrice | null {
  const slug = model.trim();
  const exact = GROK_PRICE_TABLE[slug];
  if (exact) return exact;
  const base = Object.keys(GROK_PRICE_TABLE)
    .filter((key) => slug.startsWith(`${key}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? (GROK_PRICE_TABLE[base] ?? null) : null;
}

/**
 * Estimated cost for one call. Output tokens are the larger of completion_tokens and
 * total_tokens - prompt_tokens, so reasoning tokens are counted whether or not the API
 * folds them into completion_tokens.
 */
export function estimateGrokCostUsd(
  model: string,
  usage: GrokUsage,
): { estUsd: number | null; note: string } {
  if (usage.promptTokens === null || (usage.completionTokens === null && usage.totalTokens === null)) {
    return { estUsd: null, note: "usage not reported by the API" };
  }
  const price = lookupGrokPrice(model);
  if (!price) return { estUsd: null, note: `no price listed for ${model}` };
  const prompt = usage.promptTokens;
  const fromTotal = usage.totalTokens !== null ? Math.max(0, usage.totalTokens - prompt) : 0;
  const output = Math.max(usage.completionTokens ?? 0, fromTotal);
  const long = prompt >= GROK_LONG_CONTEXT_PROMPT_TOKENS;
  const inRate = long ? price.longInputPerMTok : price.inputPerMTok;
  const outRate = long ? price.longOutputPerMTok : price.outputPerMTok;
  const usd = (prompt * inRate + output * outRate) / 1_000_000;
  return {
    estUsd: Math.round(usd * 1_000_000) / 1_000_000,
    note: `estimate from the public price table of ${GROK_PRICE_TABLE_CHECKED}, not a bill`,
  };
}

export function buildGrokTelemetry(input: {
  requestedModel: string;
  body: unknown;
  latencyMs: number;
}): GrokTelemetry {
  const usage = readGrokUsage(input.body);
  const servedModel = readGrokServedModel(input.body);
  const cost = estimateGrokCostUsd(servedModel ?? input.requestedModel, usage);
  const billed =
    usage.costInUsdTicks === null
      ? { billedCostUsd: null, billedNote: BILLED_COST_NOT_REPORTED }
      : {
          billedCostUsd: billedUsdFromTicks(usage.costInUsdTicks),
          billedNote: "billed cost from usage.cost_in_usd_ticks",
        };
  return {
    requestedModel: input.requestedModel,
    servedModel,
    ...usage,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    estUsd: cost.estUsd,
    estNote: cost.note,
    ...billed,
  };
}

function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** One line for a PR comment footer. */
export function formatGrokTelemetryLine(t: GrokTelemetry): string {
  const model = t.servedModel ?? `${t.requestedModel} (response did not report a model)`;
  const tokens =
    t.promptTokens === null || t.completionTokens === null
      ? "token usage not reported"
      : `${t.promptTokens} prompt / ${t.completionTokens} completion tokens` +
        (t.reasoningTokens ? ` (${t.reasoningTokens} reasoning)` : "");
  const cached =
    t.cachedPromptTokens === null ? "" : ` · ${t.cachedPromptTokens} cached prompt tokens`;
  const billed =
    t.billedCostUsd === null ? BILLED_COST_NOT_REPORTED : `billed cost ${formatUsd(t.billedCostUsd)}`;
  const estimate =
    t.estUsd === null ? `est. cost n/a (${t.estNote})` : `est. cost ${formatUsd(t.estUsd)} (estimate, not a bill)`;
  const requested = t.servedModel && t.servedModel !== t.requestedModel ? `; requested ${t.requestedModel}` : "";
  return `${model}${requested} · ${tokens}${cached} · ${t.latencyMs} ms · ${billed} · ${estimate}`;
}
