import type { AgentRole } from "./agents/roles.js";

/**
 * Per-agent API key provisioning for the SDLC MVP.
 *
 * RULE: every agent has its own dedicated env var(s). Shared keys
 * (`XAI_API_KEY`, `GROK_API_KEY`, `CURSOR_API_KEY`, `CURSOR_SERVICE_ACCOUNT_KEY`)
 * are intentionally NOT consulted for these agents.
 */

/** Orchestration + specialist roles that may hold a Grok / xAI key. */
export type GrokKeyedAgentRole = AgentRole;

/** Cursor Cloud Agent kinds under Builder (plus Lead/Builder Cursor keys). */
export type CursorKeyedAgentId =
  | "lead"
  | "builder"
  | "coding"
  | "testing"
  | "review";

/** Exclusive Grok/xAI env var per specialist + Lead. */
export const GROK_API_KEY_ENV: Record<GrokKeyedAgentRole, string> = {
  lead: "RELEASEDESK_GROK_API_KEY_LEAD",
  change_analyst: "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST",
  standards: "RELEASEDESK_GROK_API_KEY_STANDARDS",
  security: "RELEASEDESK_GROK_API_KEY_SECURITY",
  builder: "RELEASEDESK_GROK_API_KEY_BUILDER",
};

/** Exclusive Cursor API key env var per Lead / Builder / nested Cloud Agents. */
export const CURSOR_API_KEY_ENV: Record<CursorKeyedAgentId, string> = {
  lead: "RELEASEDESK_CURSOR_API_KEY_LEAD",
  builder: "RELEASEDESK_CURSOR_API_KEY_BUILDER",
  coding: "RELEASEDESK_CURSOR_API_KEY_CODING",
  testing: "RELEASEDESK_CURSOR_API_KEY_TESTING",
  review: "RELEASEDESK_CURSOR_API_KEY_REVIEW",
};

/** Shared env names that must never be used as a fallback for SDLC agents. */
export const FORBIDDEN_SHARED_KEY_ENV = [
  "XAI_API_KEY",
  "GROK_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_SERVICE_ACCOUNT_KEY",
] as const;

export type AgentCredentialStatus = {
  agentId: string;
  envVar: string;
  present: boolean;
  /** Always false — shared keys are never accepted. */
  usedSharedFallback: false;
};

function readExclusiveKey(
  env: NodeJS.ProcessEnv,
  envVar: string,
): string | undefined {
  const value = env[envVar];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Resolve this agent's Grok key only — never a shared XAI/GROK key. */
export function resolveAgentGrokApiKey(
  role: GrokKeyedAgentRole,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readExclusiveKey(env, GROK_API_KEY_ENV[role]);
}

/** Resolve this agent's Cursor key only — never a shared CURSOR_* key. */
export function resolveAgentCursorApiKey(
  agentId: CursorKeyedAgentId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readExclusiveKey(env, CURSOR_API_KEY_ENV[agentId]);
}

export function describeAgentGrokCredential(
  role: GrokKeyedAgentRole,
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus {
  const envVar = GROK_API_KEY_ENV[role];
  return {
    agentId: role,
    envVar,
    present: Boolean(resolveAgentGrokApiKey(role, env)),
    usedSharedFallback: false,
  };
}

export function describeAgentCursorCredential(
  agentId: CursorKeyedAgentId,
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus {
  const envVar = CURSOR_API_KEY_ENV[agentId];
  return {
    agentId,
    envVar,
    present: Boolean(resolveAgentCursorApiKey(agentId, env)),
    usedSharedFallback: false,
  };
}

/** Inventory of every exclusive key slot (for desk / doctor / .env templates). */
export function listRequiredAgentApiKeyEnvVars(): string[] {
  return [
    ...Object.values(GROK_API_KEY_ENV),
    ...Object.values(CURSOR_API_KEY_ENV),
  ];
}

export function listAgentCredentialStatuses(
  env: NodeJS.ProcessEnv = process.env,
): AgentCredentialStatus[] {
  const grok = (Object.keys(GROK_API_KEY_ENV) as GrokKeyedAgentRole[]).map((role) =>
    describeAgentGrokCredential(role, env),
  );
  const cursor = (Object.keys(CURSOR_API_KEY_ENV) as CursorKeyedAgentId[]).map(
    (id) => describeAgentCursorCredential(id, env),
  );
  return [...grok, ...cursor];
}
