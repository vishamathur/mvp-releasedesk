import { createCustomAiRedTeamingProvider } from "./custom.js";
import { createGrokGuardrailsProvider } from "./grok-guardrails-provider.js";
import {
  AiRedTeamProviderNameSchema,
  DEFAULT_AI_RED_TEAM_PROVIDER,
  type AiRedTeamProviderName,
  type AiRedTeamingProvider,
} from "./types.js";

/** Env var selecting the AI Red Teaming provider. Default / unset → `custom`. */
export const AI_RED_TEAM_PROVIDER_ENV = "RELEASEDESK_AI_RED_TEAM_PROVIDER" as const;

export type ResolveAiRedTeamingProviderOptions = {
  /** Force provider. When omitted, reads `RELEASEDESK_AI_RED_TEAM_PROVIDER`. */
  provider?: AiRedTeamProviderName;
  env?: NodeJS.ProcessEnv;
  /** Injected provider wins (tests). */
  client?: AiRedTeamingProvider;
};

export function parseAiRedTeamProviderName(
  raw: string | undefined | null,
): AiRedTeamProviderName {
  if (raw != null && String(raw).trim().toLowerCase() === "zscaler") {
    throw new Error(
      "Zscaler AI red-team provider was removed. Set RELEASEDESK_AI_RED_TEAM_PROVIDER to grok-guardrails or custom. Refusing to continue.",
    );
  }
  if (raw == null || String(raw).trim() === "") {
    return DEFAULT_AI_RED_TEAM_PROVIDER;
  }
  const parsed = AiRedTeamProviderNameSchema.safeParse(String(raw).trim().toLowerCase());
  return parsed.success ? parsed.data : DEFAULT_AI_RED_TEAM_PROVIDER;
}

/**
 * Select the custom provider (default) or the Grok guardrails probe provider.
 * `zscaler` is a configuration error.
 */
export function resolveAiRedTeamingProvider(
  options: ResolveAiRedTeamingProviderOptions = {},
): AiRedTeamingProvider {
  if (options.client) return options.client;

  const env = options.env ?? process.env;
  const name =
    options.provider ??
    parseAiRedTeamProviderName(env[AI_RED_TEAM_PROVIDER_ENV]);

  if (name === "grok-guardrails") {
    return createGrokGuardrailsProvider({ env });
  }
  return createCustomAiRedTeamingProvider();
}

export function describeAiRedTeamingProvider(provider: AiRedTeamingProvider): string {
  return provider.name === "grok-guardrails"
    ? "Grok guardrails red-team provider (RELEASEDESK_GROK_API_KEY_SECURITY)"
    : "Custom AI Red Teaming provider (no live probe engine)";
}
