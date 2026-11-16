import { createMockCloudAgentClient } from "./mock-client.js";
import {
  createRealCloudAgentClient,
  createUnavailableRealClientStub,
  hasAnyCursorApiKey,
  type RealCloudAgentClientOptions,
} from "./real-client.js";
import type { CloudAgentClient, CloudAgentClientMode, CloudAgentKind } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  /**
   * Force mode. When omitted / `auto`:
   * - only `RELEASEDESK_CLOUD_CLIENT=real` + any per-agent/legacy API key → real
   * - otherwise → mock (CI-safe default; presence of a key alone is not enough)
   */
  mode?: CloudAgentClientMode | "auto";
  env?: NodeJS.ProcessEnv;
  real?: RealCloudAgentClientOptions;
  /** Injected client wins over env resolution (tests). */
  client?: CloudAgentClient;
  /**
   * Optional hint for docs/logging — real client still resolves keys per
   * dispatch `agentKind` for NHI attribution.
   */
  agentKind?: CloudAgentKind;
};

/**
 * Select MOCK vs real Cursor Cloud Agent client.
 *
 * Enable real (prefer per-agent NHI keys):
 *   export RELEASEDESK_CURSOR_API_KEY_LEAD=...
 *   export RELEASEDESK_CURSOR_API_KEY_CODING=...
 *   # …one slot per Cloud Agent kind — see .env.example
 *   export RELEASEDESK_CLOUD_CLIENT=real
 *
 * Legacy/dev shared fallback (discouraged):
 *   export CURSOR_API_KEY=...
 *   export RELEASEDESK_CLOUD_CLIENT=real
 *
 * Force MOCK (default / CI):
 *   unset RELEASEDESK_CLOUD_CLIENT
 *   # or export RELEASEDESK_CLOUD_CLIENT=mock
 */
export function resolveCloudAgentClient(
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  const raw = options.mode ?? env.RELEASEDESK_CLOUD_CLIENT ?? "mock";
  const requested = String(raw).toLowerCase() as CloudAgentClientMode | "auto";

  // CI-safe: real only when explicitly requested (mode/env=real).
  const wantReal = requested === "real";

  if (!wantReal) {
    return createMockCloudAgentClient();
  }

  if (!options.real?.apiKey && !hasAnyCursorApiKey(env)) {
    return createUnavailableRealClientStub();
  }

  return createRealCloudAgentClient({
    ...options.real,
    env: options.real?.env ?? env,
  });
}

export function describeCloudClientMode(client: CloudAgentClient): string {
  return client.mode === "mock"
    ? "MOCK: cursor-cloud-agents (no live Cursor credentials required)"
    : "real cursor-cloud-agents (per-agent RELEASEDESK_CURSOR_API_KEY_* / legacy CURSOR_API_KEY)";
}
