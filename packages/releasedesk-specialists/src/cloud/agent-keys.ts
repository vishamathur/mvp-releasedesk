import type { CloudAgentKind } from "./types.js";

/**
 * Per-agent Cursor API key **names** for NHI (non-human identity) attribution.
 *
 * **Storage (no external vault):** configure these as **named secrets** in the
 * Cursor Cloud Agent environment (prefer Runtime Secrets) and/or Cursor Apps
 * dashboard secrets. Values are injected into `process.env` at runtime; agents
 * and the repo never hold a vault client. Prefer OIDC short-lived credentials
 * where Cursor guidance allows; long-lived API keys are the API-call fallback.
 *
 * Prefer these over the legacy shared `CURSOR_API_KEY` so usage attributes to
 * the correct agent identity. Never commit real key values — names only in
 * `.env.example`. See `docs/nhi-cursor-secrets.md`.
 */
export const CURSOR_API_KEY_ENV_BY_AGENT = {
  lead: "RELEASEDESK_CURSOR_API_KEY_LEAD",
  change_analyst: "RELEASEDESK_CURSOR_API_KEY_CHANGE_ANALYST",
  standards: "RELEASEDESK_CURSOR_API_KEY_STANDARDS",
  security: "RELEASEDESK_CURSOR_API_KEY_SECURITY",
  builder: "RELEASEDESK_CURSOR_API_KEY_BUILDER",
  ai_red_teaming: "RELEASEDESK_CURSOR_API_KEY_AI_RED_TEAMING",
  coding: "RELEASEDESK_CURSOR_API_KEY_CODING",
  testing: "RELEASEDESK_CURSOR_API_KEY_TESTING",
  review: "RELEASEDESK_CURSOR_API_KEY_REVIEW",
} as const satisfies Record<CloudAgentKind, string>;

export type CursorApiKeyAgentSlot = keyof typeof CURSOR_API_KEY_ENV_BY_AGENT;

/**
 * Where operators should store the named secrets (contract / docs constant).
 * MVP does **not** integrate an external vault SDK.
 */
export const NHI_SECRET_STORAGE = {
  primary: "cursor_cloud_agent_environment_secrets",
  secondary: "cursor_apps_dashboard_secrets",
  preferredSecretType: "runtime_secret",
  preferOidcOverLongLivedKeys: true,
  externalVaultRequired: false,
} as const;

/** Legacy shared key — fallback for local/dev only when a per-agent slot is unset. */
export const LEGACY_SHARED_CURSOR_API_KEY_ENV = [
  "CURSOR_API_KEY",
  "CURSOR_SERVICE_ACCOUNT_KEY",
] as const;

/**
 * Zscaler AI Red Teaming provider credential **names** (distinct NHI).
 * Store as Cursor named secrets (Apps and/or Cloud Agent environment) — not an
 * external vault. Presence still does not call live Zscaler — see core stub.
 */
export const ZSCALER_PROVIDER_CREDENTIAL_ENV = {
  primary: "RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY",
  /** Legacy aliases kept for compatibility with core zscaler stub. */
  legacy: [
    "ZSCALER_AI_RED_TEAM_API_KEY",
    "ZSCALER_AIRT_API_KEY",
    "AIGUARD_API_KEY",
  ] as const,
} as const;

export type ResolvedAgentApiKey = {
  agentKind: CloudAgentKind;
  /** Env var name that supplied the key (or attempted preferred slot). */
  envName: string;
  /** True when value came from CURSOR_API_KEY / CURSOR_SERVICE_ACCOUNT_KEY. */
  usedLegacySharedFallback: boolean;
  /** Redacted presence only — never return the secret to callers in logs. */
  present: boolean;
  /** Actual key when present (callers must not log this). */
  apiKey?: string;
};

function trimKey(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Resolve the Cursor API key for a specific Cloud Agent kind (NHI tracking).
 * Order: per-agent `RELEASEDESK_CURSOR_API_KEY_*` → legacy shared key (dev only).
 */
export function resolveCursorApiKeyForAgent(
  agentKind: CloudAgentKind,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentApiKey {
  const preferred = CURSOR_API_KEY_ENV_BY_AGENT[agentKind];
  const perAgent = trimKey(env[preferred]);
  if (perAgent) {
    return {
      agentKind,
      envName: preferred,
      usedLegacySharedFallback: false,
      present: true,
      apiKey: perAgent,
    };
  }

  for (const legacy of LEGACY_SHARED_CURSOR_API_KEY_ENV) {
    const shared = trimKey(env[legacy]);
    if (shared) {
      return {
        agentKind,
        envName: legacy,
        usedLegacySharedFallback: true,
        present: true,
        apiKey: shared,
      };
    }
  }

  return {
    agentKind,
    envName: preferred,
    usedLegacySharedFallback: false,
    present: false,
  };
}

/** Legacy helper: any shared key without agent attribution (prefer per-agent). */
export function resolveLegacySharedCursorApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const legacy of LEGACY_SHARED_CURSOR_API_KEY_ENV) {
    const shared = trimKey(env[legacy]);
    if (shared) return shared;
  }
  return undefined;
}

/** List all preferred per-agent env names (docs / .env.example generation). */
export function listPerAgentCursorApiKeyEnvNames(): string[] {
  return Object.values(CURSOR_API_KEY_ENV_BY_AGENT);
}

export function describeAgentKeyResolution(resolved: ResolvedAgentApiKey): string {
  if (!resolved.present) {
    return `no key for ${resolved.agentKind} (expected ${resolved.envName})`;
  }
  if (resolved.usedLegacySharedFallback) {
    return `${resolved.agentKind} using legacy shared ${resolved.envName} (prefer ${CURSOR_API_KEY_ENV_BY_AGENT[resolved.agentKind]})`;
  }
  return `${resolved.agentKind} NHI key from ${resolved.envName}`;
}
