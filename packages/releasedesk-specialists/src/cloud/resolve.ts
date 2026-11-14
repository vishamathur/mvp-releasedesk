import { createMockCloudAgentClient } from "./mock-client.js";
import {
  createRealCloudAgentClient,
  createUnavailableRealClientStub,
  resolveCursorApiKey,
  type RealCloudAgentClientOptions,
} from "./real-client.js";
import type { CloudAgentClient, CloudAgentClientMode } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  /**
   * Force mode. When omitted / `auto`:
   * - only `RELEASEDESK_CLOUD_CLIENT=real` + API key → real
   * - otherwise → mock (CI-safe default; presence of a key alone is not enough)
   */
  mode?: CloudAgentClientMode | "auto";
  env?: NodeJS.ProcessEnv;
  real?: RealCloudAgentClientOptions;
  /** Injected client wins over env resolution (tests). */
  client?: CloudAgentClient;
};

/**
 * Select MOCK vs real Cursor Cloud Agent client.
 *
 * Enable real:
 *   export CURSOR_API_KEY=...   # or CURSOR_SERVICE_ACCOUNT_KEY
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
  const apiKey = options.real?.apiKey ?? resolveCursorApiKey(env);

  // CI-safe: real only when explicitly requested (mode/env=real).
  const wantReal = requested === "real";

  if (!wantReal) {
    return createMockCloudAgentClient();
  }

  if (!apiKey) {
    return createUnavailableRealClientStub();
  }

  return createRealCloudAgentClient({
    ...options.real,
    apiKey,
  });
}

export function describeCloudClientMode(client: CloudAgentClient): string {
  return client.mode === "mock"
    ? "MOCK: cursor-cloud-agents (no live Cursor credentials required)"
    : "real cursor-cloud-agents (CURSOR_API_KEY)";
}
