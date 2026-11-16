import {
  CURSOR_API_KEY_ENV,
  resolveAgentCursorApiKey,
  type CursorKeyedAgentId,
} from "@releasedesk/core";
import { createMockCloudAgentClient } from "./mock-client.js";
import {
  createRealCloudAgentClient,
  createUnavailableRealClientStub,
  type RealCloudAgentClientOptions,
} from "./real-client.js";
import type { CloudAgentClient, CloudAgentClientMode, CloudAgentKind } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  /**
   * Force mode. When omitted / `auto`:
   * - only `RELEASEDESK_CLOUD_CLIENT=real` + ≥1 exclusive Coding/Testing/Review key → real
   * - otherwise → mock (CI-safe default)
   */
  mode?: CloudAgentClientMode | "auto";
  env?: NodeJS.ProcessEnv;
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

function anyExclusiveCloudKeyPresent(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(resolveCursorApiKeyForAgent("coding", env)) ||
    Boolean(resolveCursorApiKeyForAgent("testing", env)) ||
    Boolean(resolveCursorApiKeyForAgent("review", env))
  );
}

/**
 * Select MOCK vs real Cursor Cloud Agent client.
 *
 * Enable real:
 *   export RELEASEDESK_CURSOR_API_KEY_CODING=...
 *   export RELEASEDESK_CURSOR_API_KEY_TESTING=...
 *   export RELEASEDESK_CURSOR_API_KEY_REVIEW=...
 *   export RELEASEDESK_CLOUD_CLIENT=real
 *
 * Each kind uses its own exclusive key at dispatch time.
 * Shared CURSOR_API_KEY is never consulted.
 */
export function resolveCloudAgentClient(
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  const raw = options.mode ?? env.RELEASEDESK_CLOUD_CLIENT ?? "mock";
  const requested = String(raw).toLowerCase() as CloudAgentClientMode | "auto";
  const wantReal = requested === "real";

  if (!wantReal) {
    return createMockCloudAgentClient();
  }

  // Explicit single-key override (tests / injection) — still not a shared env fallback.
  if (options.real?.apiKey) {
    return createRealCloudAgentClient({
      ...options.real,
      apiKey: options.real.apiKey,
    });
  }

  if (!anyExclusiveCloudKeyPresent(env)) {
    return createUnavailableRealClientStub("RELEASEDESK_CURSOR_API_KEY_CODING");
  }

  return createRealCloudAgentClient({
    ...options.real,
    resolveApiKeyForKind: (kind) =>
      resolveCursorApiKeyForAgent(cursorAgentIdForKind(kind), env),
  });
}

export function describeCloudClientMode(client: CloudAgentClient): string {
  return client.mode === "mock"
    ? "MOCK: cursor-cloud-agents (no live Cursor credentials required)"
    : `real cursor-cloud-agents (per-agent ${CURSOR_API_KEY_ENV.coding} / ${CURSOR_API_KEY_ENV.testing} / ${CURSOR_API_KEY_ENV.review})`;
}
