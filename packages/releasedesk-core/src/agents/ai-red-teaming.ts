import { z } from "zod";
import { AgentInvocationBaseSchema, AgentResultBaseSchema } from "./common.js";
import { AgentRoleSchema } from "./roles.js";

/**
 * AI Red Teaming — specialist for AI/ML threats (distinct from Security).
 *
 * Primary frameworks: MITRE ATLAS + OWASP LLM Top 10.
 * Invoked as a cross-cutting guardrail on every AI model/prompt touchpoint
 * (specialists, Cloud Agents, Builder) and as a dedicated post-Builder pass
 * before the ATLAS/OWASP hard block.
 */

/** Where AI Red Teaming was applied in the SDLC. */
export const AiRedTeamingTouchpointSchema = z.enum([
  "change_analyst",
  "standards",
  "security",
  "builder",
  "cloud_coding",
  "cloud_testing",
  "cloud_review",
  "post_builder",
  "sdlc_ai_prompt",
]);

export type AiRedTeamingTouchpoint = z.infer<typeof AiRedTeamingTouchpointSchema>;

/** Pass kind — guardrail mid-flow vs dedicated post-Builder vs hard-block eval. */
export const AiRedTeamingPassKindSchema = z.enum([
  "guardrail",
  "post_builder",
  "hard_block",
]);

export type AiRedTeamingPassKind = z.infer<typeof AiRedTeamingPassKindSchema>;

export const AiRedTeamingAgentInputSchema = AgentInvocationBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.ai_red_teaming),
  repository: z.string().min(1),
  /** SDLC touchpoint being red-teamed. */
  touchpoint: AiRedTeamingTouchpointSchema,
  /** Guardrail vs dedicated post-Builder vs hard-block evaluation. */
  passKind: AiRedTeamingPassKindSchema.default("guardrail"),
  /** Subject text (prompt, model output, or agent summary) under review. */
  subjectText: z.string().default(""),
  /** Optional subject metadata (prompt ids, model ids, PR draft state). */
  subjectMeta: z
    .object({
      sourceAgent: z.string().optional(),
      promptId: z.string().optional(),
      modelId: z.string().optional(),
      /** When true, ATLAS/OWASP hard block is exempt (draft PRs). */
      prDraft: z.boolean().optional(),
      /** When true, PR is review-ready (hard block applies). */
      reviewReady: z.boolean().optional(),
    })
    .default({}),
  /** Test / demo hooks — force findings into the pass. */
  injectFindings: z
    .array(
      z.object({
        id: z.string().min(1),
        severity: z.enum(["info", "low", "medium", "high", "critical"]),
        title: z.string().min(1),
        summary: z.string().min(1),
        framework: z.enum(["mitre_atlas", "owasp_llm", "both"]),
        atlasTechnique: z.string().optional(),
        owaspLlmId: z.string().optional(),
        releaseBlocking: z.boolean().default(false),
        category: z
          .enum([
            "prompt_injection",
            "data_leakage",
            "model_poisoning",
            "adversarial_attack",
            "training_data_risk",
            "other",
          ])
          .default("other"),
      }),
    )
    .default([]),
});

export type AiRedTeamingAgentInput = z.infer<typeof AiRedTeamingAgentInputSchema>;

export const AiRedTeamingFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  framework: z.enum(["mitre_atlas", "owasp_llm", "both"]),
  atlasTechnique: z.string().optional(),
  owaspLlmId: z.string().optional(),
  category: z.enum([
    "prompt_injection",
    "data_leakage",
    "model_poisoning",
    "adversarial_attack",
    "training_data_risk",
    "other",
  ]),
  releaseBlocking: z.boolean().default(false),
  touchpoint: AiRedTeamingTouchpointSchema.optional(),
});

export type AiRedTeamingFinding = z.infer<typeof AiRedTeamingFindingSchema>;

export const AiRedTeamingAgentOutputSchema = AgentResultBaseSchema.extend({
  agentRole: z.literal(AgentRoleSchema.enum.ai_red_teaming),
  touchpoint: AiRedTeamingTouchpointSchema,
  passKind: AiRedTeamingPassKindSchema,
  findings: z.array(AiRedTeamingFindingSchema).default([]),
  releaseBlockingCount: z.number().int().nonnegative().default(0),
  riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
  frameworksApplied: z
    .array(z.enum(["mitre_atlas", "owasp_llm"]))
    .default(["mitre_atlas", "owasp_llm"]),
  /**
   * When true, Lead must be flagged in real time and route remediation
   * before continuing the SDLC stage that triggered this pass.
   */
  flagLeadRealtime: z.boolean().default(false),
  /** Hard-block recommendation for review-ready (non-draft) PRs. */
  hardBlockRecommended: z.boolean().default(false),
});

export type AiRedTeamingAgentOutput = z.infer<typeof AiRedTeamingAgentOutputSchema>;
