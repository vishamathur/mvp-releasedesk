import {
  assertGrokChatEndpoint,
  assertGrokChatStatus,
  buildGrokChatCompletionBody,
  GROK_API_KEY_ENV,
  GROK_CHAT_COMPLETIONS_URL,
  GROK_REQUEST_TIMEOUT_MS,
  GrokGuidelineError,
  resolveGrokModel,
  MissingCredentialError,
  resolveAgentGrokApiKey,
  type GrokKeyedAgentRole,
  type MockMeta,
} from "@releasedesk/core";

/**
 * Optional xAI / Grok enrichment with STRICT per-agent API keys.
 * Shared XAI_API_KEY / GROK_API_KEY are never consulted.
 */

export type GrokCompleteResult = {
  text: string;
  mocked: boolean;
  mock?: MockMeta;
};

export type GrokClientOptions = {
  apiKey?: string;
  agentRole?: GrokKeyedAgentRole;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Internal id hashed into safety_identifier. Defaults to the agent role. */
  safetySource?: string;
};

export function resolveGrokApiKeyForAgent(
  role: GrokKeyedAgentRole,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentGrokApiKey(role, env);
}

/** @deprecated Shared keys unused — always undefined. */
export function resolveGrokApiKey(_env: NodeJS.ProcessEnv = process.env): string | undefined {
  return undefined;
}

export async function grokComplete(
  prompt: string,
  opts: GrokClientOptions = {},
): Promise<GrokCompleteResult> {
  const env = opts.env ?? process.env;
  const apiKey =
    opts.apiKey ??
    (opts.agentRole !== undefined ? resolveGrokApiKeyForAgent(opts.agentRole, env) : undefined);

  if (!apiKey) {
    const envVar = opts.agentRole
      ? GROK_API_KEY_ENV[opts.agentRole]
      : "RELEASEDESK_GROK_API_KEY_*";
    throw new MissingCredentialError(envVar);
  }

  const endpoint = opts.endpoint ?? GROK_CHAT_COMPLETIONS_URL;
  assertGrokChatEndpoint(endpoint);
  const model = opts.model ?? resolveGrokModel(env);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = buildGrokChatCompletionBody({
    model,
    safetySource: opts.safetySource ?? `bot:${opts.agentRole ?? "grok"}`,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a Release Desk specialist. Reply with concise, evidence-oriented prose only.",
      },
      { role: "user", content: prompt },
    ],
  });

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROK_REQUEST_TIMEOUT_MS),
    });

    assertGrokChatStatus(res.status);
    if (!res.ok) {
      throw new Error(`Grok request failed (${res.status})`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("Empty Grok response");
    }
    return { text, mocked: false };
  } catch (err) {
    if (err instanceof MissingCredentialError || err instanceof GrokGuidelineError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Grok request failed: ${message}`);
  }
}
