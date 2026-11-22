import { createGrokGuardrailsProvider } from "./grok-guardrails-provider.js";
import {
  DEFAULT_AI_RED_TEAM_PROVIDER,
  type AiRedTeamProviderName,
  type AiRedTeamingProvider,
} from "./types.js";

/** Env var selecting the AI Red Teaming provider. Unset → `grok-guardrails`. */
export const AI_RED_TEAM_PROVIDER_ENV = "RELEASEDESK_AI_RED_TEAM_PROVIDER" as const;

export type ResolveAiRedTeamingProviderOptions = {
  provider?: AiRedTeamProviderName;
  env?: NodeJS.ProcessEnv;
};

export function parseAiRedTeamProviderName(
  raw: string | undefined | null,
): AiRedTeamProviderName {
  if (raw == null || String(raw).trim() === "") {
    return DEFAULT_AI_RED_TEAM_PROVIDER;
  }
  const name = String(raw).trim().toLowerCase();
  if (name === "grok-guardrails") return "grok-guardrails";
  throw new Error(
    `Unknown AI red-team provider "${name}". The only provider is grok-guardrails. Refusing to continue.`,
  );
}

/** Resolve the Grok guardrails provider. Any other name throws. */
export function resolveAiRedTeamingProvider(
  options: ResolveAiRedTeamingProviderOptions = {},
): AiRedTeamingProvider {
  const env = options.env ?? process.env;
  const name = options.provider ?? parseAiRedTeamProviderName(env[AI_RED_TEAM_PROVIDER_ENV]);
  if (name !== "grok-guardrails") {
    throw new Error(
      `Unknown AI red-team provider "${name}". The only provider is grok-guardrails. Refusing to continue.`,
    );
  }
  return createGrokGuardrailsProvider({ env });
}

export function describeAiRedTeamingProvider(_provider: AiRedTeamingProvider): string {
  return "Grok guardrails red-team provider (RELEASEDESK_GROK_API_KEY_SECURITY)";
}
