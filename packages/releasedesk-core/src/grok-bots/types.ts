import { z } from "zod";
import { AgentRoleSchema } from "../agents/roles.js";

/** Machine-readable Grok Bot definition (SpaceXAI roster). */
export const GrokBotSkillDefSchema = z.object({
  name: z.string().min(1),
  whenToUse: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  requiresApproval: z.array(z.string()).default([]),
  output: z.string().min(1),
});

export const GrokBotRoutineDefSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  /** Optional webhook trigger once live routine exists (never invent URLs). */
  webhookEnvHint: z.string().optional(),
});

export const GrokBotConnectorDefSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  access: z.enum(["read", "write", "read_write"]).default("read"),
});

export const GrokBotChannelDefSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
});

export const GrokBotDefinitionSchema = z.object({
  id: z.string().min(1),
  role: AgentRoleSchema,
  displayName: z.string().min(1),
  label: z.string().min(1),
  /** Exclusive RELEASEDESK_GROK_API_KEY_* — never a shared XAI/GROK key. */
  apiKeyEnv: z.string().regex(/^RELEASEDESK_GROK_API_KEY_[A-Z_]+$/),
  persona: z.object({
    job: z.string().min(1),
    personality: z.string().min(1),
    memory: z.array(z.string().min(1)).min(1),
    boundaries: z.array(z.string().min(1)).min(1),
  }),
  skills: z.array(GrokBotSkillDefSchema).min(1),
  routines: z.array(GrokBotRoutineDefSchema).min(1),
  connectors: z.array(GrokBotConnectorDefSchema).min(1),
  teammates: z.array(z.string().min(1)).default([]),
  channels: z.array(GrokBotChannelDefSchema).default([]),
  handsOffTo: z.array(z.string()).default([]),
  mandatoryOnEveryChange: z.boolean().optional(),
  markdownPackDir: z.string().min(1),
});

export const GrokBotCatalogSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  stack: z.string(),
  preserveIterationGate: z.literal("red_team|security"),
  bots: z.array(z.string().min(1)).min(1),
});

export const GrokBotRegistryEntrySchema = z.object({
  definitionId: z.string(),
  /** Only set when the Grok Bot API returned a real id — never invented. */
  liveBotId: z.string().nullable(),
  createdAt: z.string().nullable(),
  lastError: z.string().nullable().optional(),
  status: z.enum(["not_created", "created", "skipped_missing_key", "error"]),
});

export const GrokBotRegistrySchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  entries: z.array(GrokBotRegistryEntrySchema),
});

export type GrokBotSkillDef = z.infer<typeof GrokBotSkillDefSchema>;
export type GrokBotRoutineDef = z.infer<typeof GrokBotRoutineDefSchema>;
export type GrokBotConnectorDef = z.infer<typeof GrokBotConnectorDefSchema>;
export type GrokBotChannelDef = z.infer<typeof GrokBotChannelDefSchema>;
export type GrokBotDefinition = z.infer<typeof GrokBotDefinitionSchema>;
export type GrokBotCatalog = z.infer<typeof GrokBotCatalogSchema>;
export type GrokBotRegistryEntry = z.infer<typeof GrokBotRegistryEntrySchema>;
export type GrokBotRegistry = z.infer<typeof GrokBotRegistrySchema>;
