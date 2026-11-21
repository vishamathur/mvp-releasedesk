import {
  createMockMeta,
  formatMockNote,
  resolveAgentGrokApiKey,
  type GrokKeyedAgentRole,
  type MockMeta,
} from "@releasedesk/core";

/**
 * @deprecated Specialist runners no longer call Grok with per-bot keys.
 * The shipped call is apps/releasedesk/src/lib/grok-release-intel.ts,
 * which reads XAI_API_KEY and sends json_schema. This helper stays mock
 * unless the caller passes an explicit apiKey (the intel twin does).
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
  /** When set, the live call uses response_format json_schema. */
  jsonSchema?: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
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
  opts: GrokClientOptions & { fallback: string } = { fallback: "" },
): Promise<GrokCompleteResult> {
  const env = opts.env ?? process.env;
  const apiKey =
    opts.apiKey ??
    (opts.agentRole !== undefined ? resolveGrokApiKeyForAgent(opts.agentRole, env) : undefined);

  if (!apiKey) {
    const envHint = opts.agentRole
      ? `per-bot key for ${opts.agentRole} is retired`
      : "no apiKey passed — per-bot RELEASEDESK_GROK_API_KEY_* are retired";
    const mock = createMockMeta(
      "grok-api",
      `${envHint}; local heuristic (shipped path uses XAI_API_KEY)`,
    );
    return {
      text: formatMockNote(opts.fallback || "Grok enrichment skipped (no per-agent API key)"),
      mocked: true,
      mock,
    };
  }

  const endpoint = opts.endpoint ?? "https://api.x.ai/v1/chat/completions";
  const model = opts.model ?? (env.GROK_MODEL?.trim() || "grok-3");
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(opts.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: opts.jsonSchema.name,
                  strict: opts.jsonSchema.strict ?? true,
                  schema: opts.jsonSchema.schema,
                },
              },
            }
          : {}),
        messages: [
          {
            role: "system",
            content:
              "You are a Release Desk specialist. Reply with concise, evidence-oriented prose only. Do not approve human gates.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const mock = createMockMeta("grok-api", `Grok HTTP ${res.status}; falling back to local narrative`);
      return {
        text: formatMockNote(opts.fallback || `Grok request failed (${res.status})`),
        mocked: true,
        mock,
      };
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      const mock = createMockMeta("grok-api", "Empty Grok response; local fallback");
      return {
        text: formatMockNote(opts.fallback || "Empty Grok response"),
        mocked: true,
        mock,
      };
    }
    return { text, mocked: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const mock = createMockMeta("grok-api", `Grok error: ${message}`);
    return {
      text: formatMockNote(opts.fallback || `Grok error: ${message}`),
      mocked: true,
      mock,
    };
  }
}
