import type { AgentRole } from "./agents/roles.js";

/**
 * Application Grok API credential.
 *
 * One key authenticates shipped application calls (`grok-release-intel`).
 * Grok Bot teammates do not take API keys. Per-bot
 * `RELEASEDESK_GROK_API_KEY_*` and `RELEASEDESK_CURSOR_API_KEY_*` slots
 * are retired and ignored. Desk does not launch Cursor cloud agents;
 * the Builder bot does that inside the Grok Bot app.
 */

/** Orchestration + specialist roles. Kept so older call sites still type-check. */
export type GrokKeyedAgentRole = AgentRole;

/** Cursor Cloud Agent kinds. Desk no longer dispatches them. */
export type CursorKeyedAgentId =
  | "lead"
  | "builder"
  | "coding"
  | "testing"
  | "review";

/** Single app-level key for shipped Grok API calls. Never commit the value. */
export const APP_GROK_API_KEY_ENV = "XAI_API_KEY";

/**
 * @deprecated Per-bot Grok keys are retired. Names remain so old env files
 * are recognizable. {@link resolveAgentGrokApiKey} never reads them.
 */
export const GROK_API_KEY_ENV: Record<GrokKeyedAgentRole, string> = {
  lead: "RELEASEDESK_GROK_API_KEY_LEAD",
  change_analyst: "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST",
  standards: "RELEASEDESK_GROK_API_KEY_STANDARDS",
  security: "RELEASEDESK_GROK_API_KEY_SECURITY",
  builder: "RELEASEDESK_GROK_API_KEY_BUILDER",
};

/**
 * @deprecated Per-bot Cursor keys are retired. Builder launches the cloud
 * agent from the Grok Bot app. These names are never read.
 */
export const CURSOR_API_KEY_ENV: Record<CursorKeyedAgentId, string> = {
  lead: "RELEASEDESK_CURSOR_API_KEY_LEAD",
  builder: "RELEASEDESK_CURSOR_API_KEY_BUILDER",
  coding: "RELEASEDESK_CURSOR_API_KEY_CODING",
  testing: "RELEASEDESK_CURSOR_API_KEY_TESTING",
  review: "RELEASEDESK_CURSOR_API_KEY_REVIEW",
};

/** Env names that must not authenticate the shipped Grok call or a bot. */
export const RETIRED_KEY_ENV = [
  ...Object.values(GROK_API_KEY_ENV),
  ...Object.values(CURSOR_API_KEY_ENV),
  "GROK_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_SERVICE_ACCOUNT_KEY",
] as const;

/**
 * @deprecated Alias of {@link RETIRED_KEY_ENV} plus nothing else.
 * `XAI_API_KEY` is the app key, so it is not in this list.
 */
export const FORBIDDEN_SHARED_KEY_ENV = [
  "GROK_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_SERVICE_ACCOUNT_KEY",
] as const;

export type AgentCredentialStatus = {
  agentId: string;
  envVar: string;
  present: boolean;
  /** Always false — there is no second key to fall back to. */
  usedSharedFallback: false;
};

function readKey(env: NodeJS.ProcessEnv, envVar: string): string | undefined {
  const value = env[envVar];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Resolve the single app Grok key. Per-bot and GROK_API_KEY values are ignored. */
export function resolveAppGrokApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readKey(env, APP_GROK_API_KEY_ENV);
}

/**
 * @deprecated Per-bot Grok keys are retired. Always returns undefined.
 * Use {@link resolveAppGrokApiKey} for the shipped Grok API call.
 */
export function resolveAgentGrokApiKey(
  _role: GrokKeyedAgentRole,
  _env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return undefined;
}

/**
 * @deprecated Desk does not dispatch Cursor agents. Always returns undefined.
 */
export function resolveAgentCursorApiKey(
  _agentId: CursorKeyedAgentId,
  _env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return undefined;
}

export function describeAppGrokCredential(
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus {
  return {
    agentId: "app",
    envVar: APP_GROK_API_KEY_ENV,
    present: Boolean(resolveAppGrokApiKey(env)),
    usedSharedFallback: false,
  };
}

/** @deprecated Presence follows the app key, not a per-role slot. */
export function describeAgentGrokCredential(
  role: GrokKeyedAgentRole,
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus {
  return {
    agentId: role,
    envVar: APP_GROK_API_KEY_ENV,
    present: Boolean(resolveAppGrokApiKey(env)),
    usedSharedFallback: false,
  };
}

/** @deprecated Cursor keys are retired. `present` is always false. */
export function describeAgentCursorCredential(
  agentId: CursorKeyedAgentId,
  _env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus {
  return {
    agentId,
    envVar: CURSOR_API_KEY_ENV[agentId],
    present: false,
    usedSharedFallback: false,
  };
}

/** The only key the shipped Grok path reads. */
export function listRequiredAgentApiKeyEnvVars(): string[] {
  return [APP_GROK_API_KEY_ENV];
}

export function listAgentCredentialStatuses(
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus[] {
  return [describeAppGrokCredential(env)];
}
