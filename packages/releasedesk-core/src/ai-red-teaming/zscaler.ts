import { createMockMeta, formatMockNote } from "../mock.js";
import {
  ZscalerAiRedTeamNotWiredError,
  type AiRedTeamFinding,
  type AiRedTeamFramework,
  type AiRedTeamHealthCheck,
  type AiRedTeamProbeResult,
  type AiRedTeamProbeTarget,
  type AiRedTeamingProvider,
} from "./types.js";

/**
 * Credential env keys recognized by the Zscaler stub.
 * Presence means "subscription configured" — the stub still does **not** call
 * Zscaler APIs (throws not-wired). Absence → MOCK sample findings for CI/demo.
 */
export const ZSCALER_AI_RED_TEAM_CREDENTIAL_ENV_KEYS = [
  /** Preferred Release Desk NHI slot for the Zscaler provider stub. */
  "RELEASEDESK_ZSCALER_AI_RED_TEAM_API_KEY",
  "ZSCALER_AI_RED_TEAM_API_KEY",
  "ZSCALER_AIRT_API_KEY",
  "AIGUARD_API_KEY",
] as const;

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

function filterByFrameworks(
  findings: AiRedTeamFinding[],
  frameworks: readonly AiRedTeamFramework[],
): AiRedTeamFinding[] {
  if (frameworks.length === 0) return findings;
  const wantAtlas = frameworks.includes("atlas");
  const wantOwasp = frameworks.includes("owasp_llm_top_10");
  return findings.filter((f) => {
    if (wantAtlas && f.atlas.length > 0) return true;
    if (wantOwasp && f.owasp.length > 0) return true;
    return false;
  });
}

/** Deterministic MOCK findings labeled for Zscaler provider (no network). */
export function createZscalerMockFindings(app: string): AiRedTeamFinding[] {
  const mock = createMockMeta(
    "zscaler-ai-red-teaming",
    "Zscaler credentials unavailable; returning MOCK sample findings (no live API call)",
  );

  return [
    {
      id: "zscaler-mock-jailbreak",
      severity: "high",
      title: "MOCK: Jailbreak / policy bypass probe",
      summary: formatMockNote(
        `Zscaler AI Red Teaming sample: jailbreak probe against ${app}`,
      ),
      atlas: ["AML.T0054"],
      owasp: ["LLM01"],
      releaseBlocking: true,
      mocked: true,
      mock,
    },
    {
      id: "zscaler-mock-hallucination",
      severity: "medium",
      title: "MOCK: Hallucination / misinformation probe",
      summary: formatMockNote(
        `Zscaler AI Red Teaming sample: hallucination probe against ${app}`,
      ),
      atlas: ["AML.T0048.000"],
      owasp: ["LLM09"],
      releaseBlocking: false,
      mocked: true,
      mock,
    },
    {
      id: "zscaler-mock-rag-poison",
      severity: "critical",
      title: "MOCK: RAG poisoning / indirect injection",
      summary: formatMockNote(
        `Zscaler AI Red Teaming sample: RAG poisoning probe against ${app}`,
      ),
      atlas: ["AML.T0051.001"],
      owasp: ["LLM03"],
      releaseBlocking: true,
      mocked: true,
      mock,
    },
  ];
}

export type ZscalerAiRedTeamingProviderOptions = {
  env?: NodeJS.ProcessEnv;
  /** Inject credentials for tests (skips env lookup when set, including empty). */
  apiKey?: string | null;
};

/**
 * Optional Zscaler AI Red Teaming provider stub.
 *
 * - No credentials → MOCK mode (sample ATLAS/OWASP findings, CI-safe).
 * - Credentials present → `not_wired`: healthCheck reports not wired;
 *   `runProbes` throws `ZscalerAiRedTeamNotWiredError` (never calls Zscaler).
 */
export function createZscalerAiRedTeamingProvider(
  options: ZscalerAiRedTeamingProviderOptions = {},
): AiRedTeamingProvider {
  const env = options.env ?? process.env;
  const hasCreds =
    options.apiKey !== undefined
      ? Boolean(options.apiKey && String(options.apiKey).trim())
      : Boolean(resolveZscalerAiRedTeamCredentials(env));

  return {
    name: "zscaler",

    async healthCheck(): Promise<AiRedTeamHealthCheck> {
      if (hasCreds) {
        return {
          provider: "zscaler",
          ok: false,
          mode: "not_wired",
          message:
            "Zscaler credentials present but live AI Red Teaming API is not wired (stub; no outbound calls)",
        };
      }
      return {
        provider: "zscaler",
        ok: true,
        mode: "mock",
        message: formatMockNote(
          "Zscaler AI Red Teaming provider in MOCK mode (no credentials; sample findings only)",
        ),
      };
    },

    async runProbes(
      target: AiRedTeamProbeTarget,
      frameworks: readonly AiRedTeamFramework[],
    ): Promise<AiRedTeamProbeResult> {
      if (hasCreds) {
        // Documented path: refuse live Zscaler calls until a real client is wired.
        throw new ZscalerAiRedTeamNotWiredError();
      }

      const app = target.appLabel ?? target.repository ?? target.endpoint ?? "unknown-target";
      const findings = filterByFrameworks(createZscalerMockFindings(app), frameworks);
      const mock = createMockMeta(
        "zscaler-ai-red-teaming",
        "Zscaler credentials unavailable; MOCK sample findings (no live API call)",
      );

      return {
        provider: "zscaler",
        mode: "mock",
        findings,
        summary: formatMockNote(
          `Zscaler AI Red Teaming MOCK returned ${findings.length} sample finding(s) for ${app}`,
        ),
        mocksUsed: [mock],
      };
    },
  };
}
