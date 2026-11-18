import { createCustomAiRedTeamingProvider } from "./custom.js";
import { createZscalerAiRedTeamingProvider } from "./zscaler.js";
import {
  AiRedTeamProviderNameSchema,
  DEFAULT_AI_RED_TEAM_PROVIDER,
  type AiRedTeamProviderName,
  type AiRedTeamingProvider,
} from "./types.js";

/** Env var selecting AI Red Teaming provider. Default / unset → `custom`. */
export const AI_RED_TEAM_PROVIDER_ENV = "RELEASEDESK_AI_RED_TEAM_PROVIDER" as const;

export type ResolveAiRedTeamingProviderOptions = {
  /**
   * Force provider. When omitted, reads `RELEASEDESK_AI_RED_TEAM_PROVIDER`
   * (`custom` | `zscaler`). Unset / empty / unknown → `custom`.
   */
  provider?: AiRedTeamProviderName;
  env?: NodeJS.ProcessEnv;
  /** Injected provider wins (tests). */
  client?: AiRedTeamingProvider;
  /** Forwarded to Zscaler stub when selected. */
  zscalerApiKey?: string | null;
};

export function parseAiRedTeamProviderName(
  raw: string | undefined | null,
): AiRedTeamProviderName {
  if (raw == null || String(raw).trim() === "") {
    return DEFAULT_AI_RED_TEAM_PROVIDER;
  }
  const parsed = AiRedTeamProviderNameSchema.safeParse(String(raw).trim().toLowerCase());
  return parsed.success ? parsed.data : DEFAULT_AI_RED_TEAM_PROVIDER;
}

/**
 * Select custom (default) vs optional Zscaler AI Red Teaming provider.
 *
 * ```bash
 * # default — custom agent contract
 * unset RELEASEDESK_AI_RED_TEAM_PROVIDER
 *
 * # optional Zscaler stub (MOCK without credentials)
 * export RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler
 * ```
 */
export function resolveAiRedTeamingProvider(
  options: ResolveAiRedTeamingProviderOptions = {},
): AiRedTeamingProvider {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  const name =
    options.provider ??
    parseAiRedTeamProviderName(env[AI_RED_TEAM_PROVIDER_ENV]);

  if (name === "zscaler") {
    return createZscalerAiRedTeamingProvider({
      env,
      ...(options.zscalerApiKey !== undefined
        ? { apiKey: options.zscalerApiKey }
        : {}),
    });
  }

  return createCustomAiRedTeamingProvider();
}

export function describeAiRedTeamingProvider(provider: AiRedTeamingProvider): string {
  return provider.name === "zscaler"
    ? "Zscaler AI Red Teaming provider (optional; MOCK without credentials)"
    : "Custom AI Red Teaming provider (default)";
}
