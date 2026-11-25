import { createHash } from "node:crypto";

/**
 * Shared Grok chat-completions guardrails.
 * Fields match the documented xAI chat-completions request:
 * https://docs.x.ai/developers/advanced-api-usage/custom-moderation-controls
 * https://docs.x.ai/developers/faq/security
 *
 * Guidelines are not sent on the Agents management API. That endpoint's
 * documented body is name + instructions only.
 */

export const GROK_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";
export const GROK_REQUEST_TIMEOUT_MS = 30_000;

export const GROK_GUIDELINES = [
  { type: "policy", category: "nsfw", behavior: "decline" },
  { type: "policy", category: "violence", behavior: "decline" },
  { type: "policy", category: "profanity", behavior: "decline" },
] as const;

export type GrokGuideline = (typeof GROK_GUIDELINES)[number];

export type GrokChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class GrokGuidelineError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      `Grok rejected the request (${status}). Guidelines could not be applied. Refusing to continue.`,
    );
    this.name = "GrokGuidelineError";
    this.status = status;
  }
}

/** SHA-256 hex of an internal id. Never pass an email, phone, or display name. */
export function hashSafetyIdentifier(internalId: string): string {
  const source = internalId.trim();
  if (!source) {
    throw new Error("safety identifier source is empty");
  }
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function assertGrokChatEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Grok endpoint is not a URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.x.ai") {
    throw new Error("Grok chat completions must use https://api.x.ai");
  }
  if (parsed.pathname !== "/v1/chat/completions") {
    throw new Error("Grok chat completions path must be /v1/chat/completions");
  }
}

/**
 * Chat-completions body with guidelines and a hashed safety_identifier.
 * Does not set `stop` or `n`. Rejects multi-agent model ids, which the API
 * refuses when guidelines are present.
 */
export function buildGrokChatCompletionBody(input: {
  model: string;
  messages: readonly GrokChatMessage[];
  safetySource: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}): Record<string, unknown> {
  const model = input.model.trim();
  if (!model) throw new Error("Grok model is empty");
  if (/multi-agent/i.test(model)) {
    throw new Error(`Model ${model} cannot be used with guidelines`);
  }
  if (input.messages.length === 0) throw new Error("Grok messages are empty");

  const body: Record<string, unknown> = {
    model,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    guidelines: GROK_GUIDELINES.map((item) => ({ ...item })),
    safety_identifier: hashSafetyIdentifier(input.safetySource),
  };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.max_tokens !== undefined) body.max_tokens = input.max_tokens;
  if (input.response_format !== undefined) body.response_format = input.response_format;
  return body;
}

/** 400 and 422 mean the guidelines were rejected. Callers must not invent a result. */
export function assertGrokChatStatus(status: number): void {
  if (status === 400 || status === 422) throw new GrokGuidelineError(status);
}
