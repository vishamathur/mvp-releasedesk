import {
  CURSOR_API_KEY_ENV,
  MissingCredentialError,
  resolveAgentCursorApiKey,
  type CursorKeyedAgentId,
} from "@releasedesk/core";
import {
  createRealCloudAgentClient,
  type RealCloudAgentClientOptions,
} from "./real-client.js";
import type { CloudAgentClient, CloudAgentKind } from "./types.js";

export type ResolveCloudAgentClientOptions = {
  env?: NodeJS.ProcessEnv;
  real?: RealCloudAgentClientOptions;
  /** Injected client wins over env resolution. */
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

const CLOUD_KINDS = ["coding", "testing", "review"] as const;

/**
 * Real Cursor Cloud Agent client only.
 * Missing exclusive keys throw. There is no stand-in client.
 */
export function resolveCloudAgentClient(
  options: ResolveCloudAgentClientOptions = {},
): CloudAgentClient {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  if (options.real?.apiKey) {
    return createRealCloudAgentClient({
      ...options.real,
      apiKey: options.real.apiKey,
    });
  }

  const missing = CLOUD_KINDS.find((id) => !resolveCursorApiKeyForAgent(id, env));
  if (missing) {
    throw new MissingCredentialError(CURSOR_API_KEY_ENV[missing]);
  }

  return createRealCloudAgentClient({
    ...options.real,
    resolveApiKeyForKind: (kind) =>
      resolveCursorApiKeyForAgent(cursorAgentIdForKind(kind), env) ?? "",
  });
}

export function describeCloudClientMode(client: CloudAgentClient): string {
  return `real cursor-cloud-agents (${CURSOR_API_KEY_ENV.coding} / ${CURSOR_API_KEY_ENV.testing} / ${CURSOR_API_KEY_ENV.review})`;
}
