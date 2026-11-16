import { CURSOR_API_KEY_ENV } from "@releasedesk/core";
import { createMockCloudAgentClient } from "./mock-client.js";
import { resolveCursorApiKeyForKind } from "./per-agent-keys.js";
import {
  createRealCloudAgentClient,
  createUnavailableRealClientStub,
  type RealCloudAgentClientOptions,
} from "./real-client.js";
import type { CloudAgentClient, CloudAgentClientMode, CloudAgentKind } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  /**
   * Force mode. When omitted / `auto`:
   * - only `RELEASEDESK_CLOUD_CLIENT=real` + exclusive per-agent key → real
   * - otherwise → mock (CI-safe default)
   */
  mode?: CloudAgentClientMode | "auto";
  env?: NodeJS.ProcessEnv;
  real?: RealCloudAgentClientOptions;
  /** Injected client wins over env resolution (tests). */
  client?: CloudAgentClient;
};

/**
 * Select MOCK vs real Cursor Cloud Agent client for a specific agent kind.
 * Each kind uses its own RELEASEDESK_CURSOR_API_KEY_* — never shared CURSOR_API_KEY.
 */
export function resolveCloudAgentClientForKind(
  agentKind: CloudAgentKind,
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  const raw = options.mode ?? env.RELEASEDESK_CLOUD_CLIENT ?? "mock";
  const requested = String(raw).toLowerCase() as CloudAgentClientMode | "auto";
  const apiKey =
    options.real?.apiKey ?? resolveCursorApiKeyForKind(agentKind, env);
  const wantReal = requested === "real";

  if (!wantReal) {
    return createMockCloudAgentClient();
  }

  if (!apiKey) {
    return createUnavailableRealClientStub(agentKind);
  }

  return createRealCloudAgentClient({
    ...options.real,
    apiKey,
    agentKind,
    env,
  });
}

/**
 * Default resolve without a kind — MOCK unless an injected client/apiKey is provided.
 * Prefer {@link resolveCloudAgentClientForKind} on the SDLC path.
 * Shared CURSOR_API_KEY is never consulted.
 */
export function resolveCloudAgentClient(
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;
  if (
    options.real?.apiKey &&
    (options.mode === "real" || options.env?.RELEASEDESK_CLOUD_CLIENT === "real")
  ) {
    return createRealCloudAgentClient({ ...options.real, env: options.env });
  }
  const env = options.env ?? process.env;
  const wantReal =
    String(options.mode ?? env.RELEASEDESK_CLOUD_CLIENT ?? "mock").toLowerCase() ===
    "real";
  if (wantReal) {
    // No kind → cannot use exclusive key; stay unavailable rather than shared-key fallback.
    return createUnavailableRealClientStub();
  }
  return createMockCloudAgentClient();
}

export function describeCloudClientMode(
  client: CloudAgentClient,
  kind?: CloudAgentKind,
): string {
  if (client.mode === "mock") {
    return "MOCK: cursor-cloud-agents (no live Cursor credentials required)";
  }
  const envVar = kind ? CURSOR_API_KEY_ENV[kind] : "RELEASEDESK_CURSOR_API_KEY_*";
  return `real cursor-cloud-agents (${envVar}; shared CURSOR_API_KEY unused)`;
}
