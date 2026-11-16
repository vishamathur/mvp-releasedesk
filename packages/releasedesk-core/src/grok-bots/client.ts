import {
  createMockMeta,
  formatMockNote,
  type MockMeta,
} from "../mock.js";
import { resolveAgentGrokApiKey } from "../agent-credentials.js";
import {
  getGrokBotDefinition,
  type GrokBotDefinition,
  type GrokBotRoutineDef,
} from "./definitions.js";
import type { AgentRole } from "../agents/roles.js";

/**
 * Grok Bot client for Release Desk.
 *
 * Official live automation surface = routine webhooks
 * (docs.x.ai/grok-bot/skills-routines-and-automations).
 * There is no public Bot create/list/chat API — setup prints firstMessage
 * for the Grok Bot app; Desk triggers via webhook when configured.
 *
 * Fallback: exclusive-key xAI chat completions for Desk-side trigger demos
 * (same model API as shipped grok-api-intel), never shared XAI_API_KEY.
 */

export type GrokBotTriggerMode = "webhook" | "xai_chat" | "mock";

export type GrokBotTriggerRequest = {
  botId: AgentRole;
  routineId?: string;
  payload?: Record<string, unknown>;
  /** Optional prompt for xAI chat fallback. */
  prompt?: string;
};

export type GrokBotTriggerResult = {
  botId: AgentRole;
  mode: GrokBotTriggerMode;
  ok: boolean;
  mocked: boolean;
  mock?: MockMeta;
  summary: string;
  /** HTTP status when webhook was called. */
  statusCode?: number;
  /** Bot definition path for the room. */
  definitionPath: string;
  /** How to open the Bot live in Grok Bot app. */
  openLive: string;
};

export type GrokBotClientOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Force mock even when webhook/key present. */
  forceMock?: boolean;
};

function readEnv(env: NodeJS.ProcessEnv, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function primaryRoutine(def: GrokBotDefinition): GrokBotRoutineDef | undefined {
  return def.routines[0];
}

export function resolveBotWebhook(
  def: GrokBotDefinition,
  env: NodeJS.ProcessEnv,
  routineId?: string,
): { url?: string; key?: string; routine: GrokBotRoutineDef | undefined } {
  const routine =
    (routineId ? def.routines.find((r) => r.id === routineId) : undefined) ??
    primaryRoutine(def);
  return {
    url: readEnv(env, routine?.webhookUrlEnv),
    key: readEnv(env, routine?.webhookKeyEnv),
    routine,
  };
}

export function describeOpenLive(def: GrokBotDefinition): string {
  return `Open Grok Bot app → find "${def.displayName}" (or create it, paste firstMessage from ${def.definitionPath}). Exclusive key: ${def.grokApiKeyEnv}.`;
}

/**
 * Trigger a Bot routine: webhook if configured, else exclusive-key xAI chat,
 * else MOCK.
 */
export async function triggerGrokBot(
  request: GrokBotTriggerRequest,
  options: GrokBotClientOptions = {},
): Promise<GrokBotTriggerResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const def = getGrokBotDefinition(request.botId);
  if (!def) {
    return {
      botId: request.botId,
      mode: "mock",
      ok: false,
      mocked: true,
      mock: createMockMeta("grok-bot", `Unknown bot id ${request.botId}`),
      summary: formatMockNote(`Unknown bot ${request.botId}`),
      definitionPath: `grok-bots/definitions/${request.botId}.json`,
      openLive: "Unknown bot — check GROK_BOT_DEFINITIONS",
    };
  }

  const openLive = describeOpenLive(def);
  const { url, key, routine } = resolveBotWebhook(def, env, request.routineId);

  if (options.forceMock) {
    const mock = createMockMeta("grok-bot", "forceMock — no live call");
    return {
      botId: def.id,
      mode: "mock",
      ok: true,
      mocked: true,
      mock,
      summary: formatMockNote(`Triggered ${def.displayName} (forced MOCK)`),
      definitionPath: def.definitionPath,
      openLive,
    };
  }

  if (url && key) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          botId: def.id,
          routineId: routine?.id,
          ...(request.payload ?? {}),
        }),
      });
      const ok = res.status === 200;
      return {
        botId: def.id,
        mode: "webhook",
        ok,
        mocked: false,
        statusCode: res.status,
        summary: ok
          ? `Webhook accepted for ${def.displayName} routine ${routine?.id ?? "default"} (200 = run started, not finished — check Bot chat)`
          : `Webhook failed HTTP ${res.status} for ${def.displayName}`,
        definitionPath: def.definitionPath,
        openLive,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const mock = createMockMeta("grok-bot", `Webhook error: ${message}`);
      return {
        botId: def.id,
        mode: "mock",
        ok: false,
        mocked: true,
        mock,
        summary: formatMockNote(`Webhook error for ${def.displayName}: ${message}`),
        definitionPath: def.definitionPath,
        openLive,
      };
    }
  }

  // Exclusive-key xAI chat fallback (Desk-side) — never shared XAI_API_KEY.
  const apiKey = resolveAgentGrokApiKey(def.id, env);
  if (apiKey) {
    const prompt =
      request.prompt ??
      [
        `You are ${def.displayName}.`,
        def.mission,
        routine ? `Routine: ${routine.instruction}` : "",
        `Payload: ${JSON.stringify(request.payload ?? {})}`,
        "Reply with a short status for Release Desk. Do not merge.",
      ]
        .filter(Boolean)
        .join("\n");

    try {
      const res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-2-latest",
          messages: [
            { role: "system", content: def.persona },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const mock = createMockMeta("grok-bot", `xAI HTTP ${res.status}`);
        return {
          botId: def.id,
          mode: "mock",
          ok: false,
          mocked: true,
          mock,
          statusCode: res.status,
          summary: formatMockNote(`xAI chat failed HTTP ${res.status}`),
          definitionPath: def.definitionPath,
          openLive,
        };
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content?.trim() ?? "(empty)";
      return {
        botId: def.id,
        mode: "xai_chat",
        ok: true,
        mocked: false,
        summary: text.slice(0, 2000),
        definitionPath: def.definitionPath,
        openLive,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const mock = createMockMeta("grok-bot", `xAI error: ${message}`);
      return {
        botId: def.id,
        mode: "mock",
        ok: false,
        mocked: true,
        mock,
        summary: formatMockNote(`xAI error: ${message}`),
        definitionPath: def.definitionPath,
        openLive,
      };
    }
  }

  const mock = createMockMeta(
    "grok-bot",
    `No webhook (${routine?.webhookUrlEnv ?? "n/a"}) and no ${def.grokApiKeyEnv}; shared XAI_API_KEY unused`,
  );
  return {
    botId: def.id,
    mode: "mock",
    ok: true,
    mocked: true,
    mock,
    summary: formatMockNote(
      `${def.displayName}: MOCK trigger — set ${def.grokApiKeyEnv} or webhook ${routine?.webhookUrlEnv ?? ""}`,
    ),
    definitionPath: def.definitionPath,
    openLive,
  };
}
