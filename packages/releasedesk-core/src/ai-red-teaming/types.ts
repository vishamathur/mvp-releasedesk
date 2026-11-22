import { z } from "zod";
import { MockMetaSchema } from "../mock.js";

/**
 * Pluggable AI Red Teaming providers.
 *
 * Select via `RELEASEDESK_AI_RED_TEAM_PROVIDER`:
 * - `custom` (default) — no live probe engine; calls throw a configuration error
 * - `grok-guardrails` — fixed adversarial prompts against the guarded Grok config
 */

export const AiRedTeamProviderNameSchema = z.enum(["custom", "grok-guardrails"]);
export type AiRedTeamProviderName = z.infer<typeof AiRedTeamProviderNameSchema>;

export const DEFAULT_AI_RED_TEAM_PROVIDER: AiRedTeamProviderName = "custom";

/** Frameworks findings must map into for hard-block semantics. */
export const AiRedTeamFrameworkSchema = z.enum(["atlas", "owasp_llm_top_10"]);
export type AiRedTeamFramework = z.infer<typeof AiRedTeamFrameworkSchema>;

export const AiRedTeamProviderModeSchema = z.enum(["mock", "not_wired", "live"]);
export type AiRedTeamProviderMode = z.infer<typeof AiRedTeamProviderModeSchema>;

export const AiRedTeamProbeTargetSchema = z.object({
  /** Repo under test (owner/name or path). */
  repository: z.string().min(1).optional(),
  /** Optional endpoint label recorded with the probe target. */
  endpoint: z.string().min(1).optional(),
  /** Optional session correlation for multi-turn probes. */
  sessionId: z.string().min(1).optional(),
  /** Free-form component / app label (e.g. northwind-kyc). */
  appLabel: z.string().min(1).optional(),
});

export type AiRedTeamProbeTarget = z.infer<typeof AiRedTeamProbeTargetSchema>;

export const AiRedTeamFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string().min(1),
  /** Human summary; MUST use `MOCK:` prefix when fabricated. */
  summary: z.string().min(1),
  /** MITRE ATLAS technique / tactic ids (e.g. AML.T0051). */
  atlas: z.array(z.string().min(1)).default([]),
  /** OWASP LLM Top 10 ids (e.g. LLM01). */
  owasp: z.array(z.string().min(1)).default([]),
  releaseBlocking: z.boolean().default(false),
  mocked: z.boolean().default(false),
  mock: MockMetaSchema.optional(),
});

export type AiRedTeamFinding = z.infer<typeof AiRedTeamFindingSchema>;

export const AiRedTeamProbeResultSchema = z.object({
  provider: AiRedTeamProviderNameSchema,
  mode: AiRedTeamProviderModeSchema,
  findings: z.array(AiRedTeamFindingSchema).default([]),
  summary: z.string().min(1),
  mocksUsed: z.array(MockMetaSchema).default([]),
});

export type AiRedTeamProbeResult = z.infer<typeof AiRedTeamProbeResultSchema>;

export const AiRedTeamHealthCheckSchema = z.object({
  provider: AiRedTeamProviderNameSchema,
  ok: z.boolean(),
  mode: AiRedTeamProviderModeSchema,
  message: z.string().min(1),
});

export type AiRedTeamHealthCheck = z.infer<typeof AiRedTeamHealthCheckSchema>;

/**
 * Shared AI Red Teaming agent contract.
 * Lead / Security can call any resolved provider interchangeably.
 */
export type AiRedTeamingProvider = {
  readonly name: AiRedTeamProviderName;
  /**
   * Run adversarial probes against `target` and map findings to the requested
   * ATLAS / OWASP frameworks.
   */
  runProbes(
    target: AiRedTeamProbeTarget,
    frameworks: readonly AiRedTeamFramework[],
  ): Promise<AiRedTeamProbeResult>;
  /** Readiness check. Must throw a configuration error when the provider cannot run. */
  healthCheck(): Promise<AiRedTeamHealthCheck>;
};
