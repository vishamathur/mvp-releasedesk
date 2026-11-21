import {
  CURSOR_API_KEY_ENV,
  resolveAgentCursorApiKey,
  type CursorKeyedAgentId,
} from "@releasedesk/core";
import { createMockCloudAgentClient } from "./mock-client.js";
import type { RealCloudAgentClientOptions } from "./real-client.js";
import type { CloudAgentClient, CloudAgentClientMode, CloudAgentKind } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  /**
   * Ignored for live dispatch. Desk stays on the mock client.
   * Builder launches Cursor from the Grok Bot app.
   */
  mode?: CloudAgentClientMode | "auto";
  env?: NodeJS.ProcessEnv;
  /** Ignored. Kept so older callers still type-check. */
  real?: RealCloudAgentClientOptions;
  /** Injected client wins over env resolution (tests). */
  client?: CloudAgentClient;
};

/** Map CloudAgentKind → exclusive Cursor agent id. */
export function cursorAgentIdForKind(kind: CloudAgentKind): CursorKeyedAgentId {
  if (kind === "coding") return "coding";
  if (kind === "testing") return "testing";
  return "review";
}

/**
 * Resolve exclusive Cursor API key for one Cloud Agent id.
 * Never falls back to CURSOR_API_KEY / CURSOR_SERVICE_ACCOUNT_KEY.
 */
export function resolveCursorApiKeyForAgent(
  agentId: CursorKeyedAgentId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveAgentCursorApiKey(agentId, env);
}

/**
 * @deprecated Shared CURSOR_* keys are not used on the SDLC path.
 * Always returns undefined — use {@link resolveCursorApiKeyForAgent}.
 */
export function resolveCursorApiKey(_env: NodeJS.ProcessEnv = process.env): string | undefined {
  return undefined;
}

/**
 * Desk no longer launches Cursor cloud agents.
 *
 * Builder does that from the Grok Bot app (skill launch-cursor-coding-agent).
 * `RELEASEDESK_CLOUD_CLIENT=real` and per-bot Cursor keys are ignored so CI
 * cannot go live from this path. An injected `options.client` is still honored
 * for unit tests of the pipeline shape.
 */
export function resolveCloudAgentClient(
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;
  return createMockCloudAgentClient();
}

export function describeCloudClientMode(client: CloudAgentClient): string {
  return client.mode === "mock"
    ? "MOCK: cursor-cloud-agents (no live Cursor credentials required)"
    : `real cursor-cloud-agents (per-agent ${CURSOR_API_KEY_ENV.coding} / ${CURSOR_API_KEY_ENV.testing} / ${CURSOR_API_KEY_ENV.review})`;
}
