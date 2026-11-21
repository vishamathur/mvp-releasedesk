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
 *
 * Host note: product Grok Bots are created in the Grok Bot app. Those teammates
 * have app agent ids in registry.json (`grokBotAppAgentId`, host `grok-bot-app`).
 * App ids are not xAI Agents API ids, app bots do not take API keys, and this
 * client never sends them. There is no public POST /v1/bots (404). The xAI
 * management endpoint is POST /v1/agents with only `name` + `instructions`.
 * Teams without Agents enabled get HTTP 403; that does not clear app teammates.
 */

export const DEFAULT_GROK_BOT_API_BASE = "https://api.x.ai/v1";
export const DEFAULT_GROK_BOT_CREATE_PATH = "/agents";

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

/** Map Desk bot packs onto the xAI Agents create schema (OpenAPI: name, instructions, …). */
function buildCreatePayload(def: GrokBotDefinition) {
  const skillLines = def.skills.map(
    (s) =>
      `- ${s.name}: ${s.whenToUse}; steps: ${s.steps.join(" → ")}; output: ${s.output}`,
  );
  const routineLines = def.routines.map(
    (r) => `- ${r.name} (trigger: ${r.trigger}): ${r.steps.join(" → ")}`,
  );
  const connectorLines = def.connectors.map(
    (c) => `- ${c.name} (${c.access}): ${c.purpose}`,
  );
  const channelLines = def.channels.map((c) => `- ${c.name}: ${c.purpose}`);
  const childLines = (def.children ?? []).map(
    (child) =>
      `- ${child.id} (group ${child.parallelGroup}, required ${child.required}): ${child.responsibility}`,
  );

  const instructions = [
    `# ${def.displayName} — ${def.label}`,
    "",
    `Role id: ${def.role}`,
    `Definition: ${def.id}`,
    `Pack: ${def.markdownPackDir}`,
    "",
    "## Job",
    def.persona.job,
    "",
    "## Personality",
    def.persona.personality,
    "",
    "## Memory",
    ...def.persona.memory.map((m) => `- ${m}`),
    "",
    "## Boundaries",
    ...def.persona.boundaries.map((b) => `- ${b}`),
    "",
    "## Skills",
    ...(skillLines.length ? skillLines : ["- (none)"]),
    "",
    "## Routines",
    ...(routineLines.length ? routineLines : ["- (none)"]),
    "",
    "## Connectors",
    ...(connectorLines.length ? connectorLines : ["- (none)"]),
    "",
    "## Teammates",
    def.teammates.length ? def.teammates.map((t) => `- ${t}`).join("\n") : "- (none)",
    "",
    "## Channels",
    ...(channelLines.length ? channelLines : ["- (none)"]),
    "",
    "## Hands off to",
    def.handsOffTo.length ? def.handsOffTo.map((t) => `- ${t}`).join("\n") : "- (none)",
    "",
    "## Child sub-agents",
    ...(childLines.length
      ? childLines
      : ["- (none — parent still owns the public result)"]),
    "Children are not separate roster bots. The parent delegates and aggregates.",
    "",
    `Mandatory on every change: ${def.mandatoryOnEveryChange ? "yes" : "no"}`,
    "Preserve iteration gate: red_team|security — never auto-merge.",
    "Source: mvp-releasedesk",
  ].join("\n");

  return {
    name: def.displayName,
    instructions,
  };
}

/**
 * Body for POST /v1/agents. Only name and instructions — never an id.
 * Grok Bot app agent ids must not be copied onto this request.
 */
export function xaiAgentsCreateBody(def: GrokBotDefinition): {
  name: string;
  instructions: string;
} {
  const payload = buildCreatePayload(def);
  return { name: payload.name, instructions: payload.instructions };
}

function formatHttpErrorBody(json: unknown, text: string, statusText: string): string {
  if (typeof json === "object" && json) {
    const o = json as Record<string, unknown>;
    const nested =
      o.error && typeof o.error === "object"
        ? (o.error as Record<string, unknown>)
        : null;
    const msg =
      (typeof o.error === "string" && o.error) ||
      (nested && typeof nested.message === "string" && nested.message) ||
      (typeof o.message === "string" && o.message) ||
      (typeof o.code === "string" && o.code) ||
      null;
    if (msg) {
      const code = typeof o.code === "string" && o.code !== msg ? ` (${o.code})` : "";
      return `${msg}${code}`;
    }
  }
  return text.slice(0, 240) || statusText;
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

    const payload = xaiAgentsCreateBody(def);
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
        body: JSON.stringify({
          name: payload.name,
          instructions: payload.instructions,
        }),
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
        const errMsg = formatHttpErrorBody(json, text, res.statusText);
        const hint =
          res.status === 404
            ? " (no public /bots route — default host is POST /v1/agents)"
            : res.status === 403
              ? " (xAI Agents API not enabled for this team/key)"
              : "";
        return {
          definitionId: def.id,
          role: def.role,
          apiKeyEnv: def.apiKeyEnv,
          status: "error",
          liveBotId: null,
          httpStatus: res.status,
          message: `Grok Bot create HTTP ${res.status}: ${errMsg}${hint}`,
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
