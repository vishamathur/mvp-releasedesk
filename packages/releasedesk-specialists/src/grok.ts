import { createMockMeta, formatMockNote, type MockMeta } from "@releasedesk/core";

/**
 * Optional xAI / Grok enrichment.
 * When `XAI_API_KEY` (or `GROK_API_KEY`) is absent, returns a MOCK-labeled fallback.
 * Full LLM wiring remains optional — local analysis is the primary M4 path.
 */

export type GrokCompleteResult = {
  text: string;
  mocked: boolean;
  mock?: MockMeta;
};

export type GrokClientOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export function resolveGrokApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.XAI_API_KEY ?? env.GROK_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

export async function grokComplete(
  prompt: string,
  opts: GrokClientOptions & { fallback: string } = { fallback: "" },
): Promise<GrokCompleteResult> {
  const apiKey = opts.apiKey ?? resolveGrokApiKey();
  if (!apiKey) {
    const mock = createMockMeta(
      "grok-api",
      "XAI_API_KEY / GROK_API_KEY unavailable; using local heuristic narrative",
    );
    return {
      text: formatMockNote(opts.fallback || "Grok enrichment skipped (no API key)"),
      mocked: true,
      mock,
    };
  }

  const endpoint = opts.endpoint ?? "https://api.x.ai/v1/chat/completions";
  const model = opts.model ?? "grok-2-latest";
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
        messages: [
          {
            role: "system",
            content:
              "You are a Release Desk specialist. Reply with concise, evidence-oriented prose only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
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
