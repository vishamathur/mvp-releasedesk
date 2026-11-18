import {
  resolveAgentGrokApiKey,
  type GrokKeyedAgentRole,
} from "../agent-credentials.js";
import type { GrokBotDefinition } from "./types.js";

/**
 * Grok Bot management client (SpaceXAI: Lead + CA + Security + Builder).
 *
 * Auth: exclusive RELEASEDESK_GROK_API_KEY_* only — never XAI_API_KEY / GROK_API_KEY.
 * Live bot IDs recorded only from successful API responses (never invented).
 */

export const DEFAULT_GROK_BOT_API_BASE = "https://api.x.ai/v1";
export const DEFAULT_GROK_BOT_CREATE_PATH = "/bots";

export type GrokBotCreateStatus =
  | "created"
  | "skipped_missing_key"
  | "error"
  | "dry_run";

export type GrokBotCreateResult = {
  definitionId: string;
  role: GrokKeyedAgentRole;
  apiKeyEnv: string;
  status: GrokBotCreateStatus;
  liveBotId: string | null;
  httpStatus?: number;
  message: string;
  dryRun: boolean;
};

export type GrokBotApiClientOptions = {
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  createPath?: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
};

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function buildCreatePayload(def: GrokBotDefinition) {
  return {
    name: def.displayName,
    title: def.label,
    description: def.persona.job,
    role: def.role,
    persona: def.persona,
    skills: def.skills,
    routines: def.routines,
    connectors: def.connectors,
    teammates: def.teammates,
    channels: def.channels,
    handsOffTo: def.handsOffTo,
    mandatoryOnEveryChange: def.mandatoryOnEveryChange ?? false,
    metadata: {
      source: "mvp-releasedesk",
      definitionId: def.id,
      markdownPackDir: def.markdownPackDir,
      preserveIterationGate: "red_team|security",
    },
  };
}

function extractLiveBotId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  for (const key of ["id", "botId", "bot_id", "agentId", "agent_id"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  const nested = o.bot ?? o.agent;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    for (const key of ["id", "botId", "bot_id", "agentId", "agent_id"]) {
      const v = n[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  }
  return null;
}

export class GrokBotApiClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly baseUrl: string;
  private readonly createPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;

  constructor(opts: GrokBotApiClientOptions = {}) {
    this.env = opts.env ?? process.env;
    const fromEnv = this.env.RELEASEDESK_GROK_BOT_API_BASE?.trim();
    this.baseUrl = opts.baseUrl ?? (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_GROK_BOT_API_BASE);
    const pathEnv = this.env.RELEASEDESK_GROK_BOT_CREATE_PATH?.trim();
    this.createPath =
      opts.createPath ?? (pathEnv && pathEnv.length > 0 ? pathEnv : DEFAULT_GROK_BOT_CREATE_PATH);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.dryRun = opts.dryRun ?? this.env.RELEASEDESK_GROK_BOT_DRY_RUN === "1";
  }

  async createBot(def: GrokBotDefinition): Promise<GrokBotCreateResult> {
    const apiKey = resolveAgentGrokApiKey(def.role, this.env);
    if (!apiKey) {
      return {
        definitionId: def.id,
        role: def.role,
        apiKeyEnv: def.apiKeyEnv,
        status: "skipped_missing_key",
        liveBotId: null,
        message: `Missing exclusive key ${def.apiKeyEnv} (shared XAI_API_KEY / GROK_API_KEY ignored)`,
        dryRun: this.dryRun,
      };
    }

    const payload = buildCreatePayload(def);
    if (this.dryRun) {
      return {
        definitionId: def.id,
        role: def.role,
        apiKeyEnv: def.apiKeyEnv,
        status: "dry_run",
        liveBotId: null,
        message: `Dry run — would POST ${joinUrl(this.baseUrl, this.createPath)} for ${def.id}`,
        dryRun: true,
      };
    }

    const url = joinUrl(this.baseUrl, this.createPath);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = { raw: text.slice(0, 500) };
        }
      }

      if (!res.ok) {
        const errMsg =
          typeof json === "object" && json && "error" in json
            ? String((json as { error?: unknown }).error)
            : text.slice(0, 240) || res.statusText;
        return {
          definitionId: def.id,
          role: def.role,
          apiKeyEnv: def.apiKeyEnv,
          status: "error",
          liveBotId: null,
          httpStatus: res.status,
          message: `Grok Bot create HTTP ${res.status}: ${errMsg}`,
          dryRun: false,
        };
      }

      const liveBotId = extractLiveBotId(json);
      if (!liveBotId) {
        return {
          definitionId: def.id,
          role: def.role,
          apiKeyEnv: def.apiKeyEnv,
          status: "error",
          liveBotId: null,
          httpStatus: res.status,
          message:
            "Create succeeded but response had no bot id — refusing to invent a liveBotId",
          dryRun: false,
        };
      }

      return {
        definitionId: def.id,
        role: def.role,
        apiKeyEnv: def.apiKeyEnv,
        status: "created",
        liveBotId,
        httpStatus: res.status,
        message: `Created live bot ${liveBotId}`,
        dryRun: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        definitionId: def.id,
        role: def.role,
        apiKeyEnv: def.apiKeyEnv,
        status: "error",
        liveBotId: null,
        message: `Grok Bot create failed: ${message}`,
        dryRun: false,
      };
    }
  }

  async createBots(defs: readonly GrokBotDefinition[]): Promise<GrokBotCreateResult[]> {
    const out: GrokBotCreateResult[] = [];
    for (const def of defs) {
      out.push(await this.createBot(def));
    }
    return out;
  }
}

export function createGrokBotApiClient(opts?: GrokBotApiClientOptions): GrokBotApiClient {
  return new GrokBotApiClient(opts);
}
