import {
  CURSOR_API_KEY_ENV,
  resolveAgentCursorApiKey,
  type CursorKeyedAgentId,
} from "@releasedesk/core";
import type { CloudAgentKind } from "./types.js";

/** Map Cloud Agent kind → exclusive Cursor key agent id. */
export function cursorAgentIdForKind(kind: CloudAgentKind): CursorKeyedAgentId {
  return kind;
}

/**
 * Resolve exclusive Cursor API key for a Cloud Agent kind (coding|testing|review).
 * Never falls back to shared CURSOR_API_KEY / CURSOR_SERVICE_ACCOUNT_KEY.
 */
export function resolveCursorApiKeyForAgent(
  kind: CloudAgentKind,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentCursorApiKey(cursorAgentIdForKind(kind), env);
}

/** Alias used by some call sites / docs. */
export const resolveCursorApiKeyForKind = resolveCursorApiKeyForAgent;

export function resolveCursorApiKeyForAgentId(
  agentId: CursorKeyedAgentId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentCursorApiKey(agentId, env);
}

export function cursorApiKeyEnvForKind(kind: CloudAgentKind): string {
  return CURSOR_API_KEY_ENV[kind];
}
