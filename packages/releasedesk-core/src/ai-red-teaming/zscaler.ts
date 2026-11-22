import { MissingCredentialError } from "../config-error.js";
import {
  ZscalerAiRedTeamNotWiredError,
  type AiRedTeamHealthCheck,
  type AiRedTeamProbeResult,
  type AiRedTeamProbeTarget,
  type AiRedTeamFramework,
  type AiRedTeamingProvider,
} from "./types.js";

/**
 * Credential env keys recognized by the Zscaler stub.
 * Presence means "subscription configured" — the stub still does **not** call
 * Zscaler APIs (throws not-wired). Absence throws MissingCredentialError.
 */
export const ZSCALER_AI_RED_TEAM_CREDENTIAL_ENV_KEYS = [
  "ZSCALER_AI_RED_TEAM_API_KEY",
  "ZSCALER_AIRT_API_KEY",
  "AIGUARD_API_KEY",
] as const;

/** Local template settings. Recognized, but not sent to Zscaler — the live client is not wired. */
export const ZSCALER_FINDINGS_ROUTING_VALUES = ["block", "warn", "report-only"] as const;
export type ZscalerFindingsRouting = (typeof ZSCALER_FINDINGS_ROUTING_VALUES)[number];

export type ZscalerLocalConfig = {
  /** Which credential env var was non-empty. The secret value is never returned. */
  credentialEnvKey?: (typeof ZSCALER_AI_RED_TEAM_CREDENTIAL_ENV_KEYS)[number];
  endpointConfigured: boolean;
  scanScope: string[];
  findingsRouting?: ZscalerFindingsRouting;
};

export function resolveZscalerAiRedTeamCredentials(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const key of ZSCALER_AI_RED_TEAM_CREDENTIAL_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read the local secrets-template shape.
 * Does not return secret values and does not open a network connection.
 * `findingsRouting` is recorded only — it does not change probe results yet.
 */
export function resolveZscalerLocalConfig(
  env: NodeJS.ProcessEnv = process.env,
): ZscalerLocalConfig {
  let credentialEnvKey: ZscalerLocalConfig["credentialEnvKey"];
  for (const key of ZSCALER_AI_RED_TEAM_CREDENTIAL_ENV_KEYS) {
    if (nonEmpty(env[key])) {
      credentialEnvKey = key;
      break;
    }
  }
  const routingRaw = nonEmpty(env.ZSCALER_AI_RED_TEAM_FINDINGS_ROUTING)?.toLowerCase();
  const findingsRouting = ZSCALER_FINDINGS_ROUTING_VALUES.find((value) => value === routingRaw);
  const scanScope = (nonEmpty(env.ZSCALER_AI_RED_TEAM_SCAN_SCOPE) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return {
    ...(credentialEnvKey !== undefined ? { credentialEnvKey } : {}),
    endpointConfigured: nonEmpty(env.ZSCALER_AI_RED_TEAM_ENDPOINT) !== undefined,
    scanScope,
    ...(findingsRouting !== undefined ? { findingsRouting } : {}),
  };
}

function notWiredMessage(config: ZscalerLocalConfig): string {
  const routing = config.findingsRouting ?? "unset";
  const scope = config.scanScope.length > 0 ? config.scanScope.join(",") : "unset";
  return (
    `Zscaler credentials present (${config.credentialEnvKey ?? "injected"}) but live AI Red Teaming API is not wired ` +
    `(stub; no outbound calls). endpointConfigured=${config.endpointConfigured}; ` +
    `scanScope=${scope}; findingsRouting=${routing} (routing is not applied yet)`
  );
}

export type ZscalerAiRedTeamingProviderOptions = {
  env?: NodeJS.ProcessEnv;
  /** Inject credentials for tests (skips env lookup when set, including empty). */
  apiKey?: string | null;
};

/**
 * Optional Zscaler AI Red Teaming provider stub.
 *
 * - No credentials → MissingCredentialError.
 * - Credentials present → `not_wired`: healthCheck reports not wired;
 *   `runProbes` throws `ZscalerAiRedTeamNotWiredError` (never calls Zscaler).
 */
export function createZscalerAiRedTeamingProvider(
  options: ZscalerAiRedTeamingProviderOptions = {},
): AiRedTeamingProvider {
  const env = options.env ?? process.env;
  const config = resolveZscalerLocalConfig(env);
  const hasCreds =
    options.apiKey !== undefined
      ? Boolean(options.apiKey && String(options.apiKey).trim())
      : config.credentialEnvKey !== undefined;

  return {
    name: "zscaler",

    async healthCheck(): Promise<AiRedTeamHealthCheck> {
      if (hasCreds) {
        return {
          provider: "zscaler",
          ok: false,
          mode: "not_wired",
          message: notWiredMessage(config),
        };
      }
      throw new MissingCredentialError("ZSCALER_AI_RED_TEAM_API_KEY");
    },

    async runProbes(
      _target: AiRedTeamProbeTarget,
      _frameworks: readonly AiRedTeamFramework[],
    ): Promise<AiRedTeamProbeResult> {
      if (hasCreds) {
        // Documented path: refuse live Zscaler calls until a real client is wired.
        throw new ZscalerAiRedTeamNotWiredError();
      }

      throw new MissingCredentialError("ZSCALER_AI_RED_TEAM_API_KEY");
    },
  };
}
