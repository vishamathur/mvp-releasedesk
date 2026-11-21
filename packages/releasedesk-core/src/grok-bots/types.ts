import { z } from "zod";
import { AgentRoleSchema } from "../agents/roles.js";

/** Machine-readable Grok Bot definition (SpaceXAI roster). */
export const GrokBotSkillDefSchema = z.object({
  name: z.string().min(1),
  whenToUse: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  requiresApproval: z.array(z.string()).default([]),
  output: z.string().min(1),
  /** Playbook path relative to the repo root. */
  playbook: z.string().min(1),
});

export const GrokBotRoutineDefSchema = z.object({
  name: z.string().min(1),
  /** Event description. Use with `schedule` when the routine is also on a clock. */
  trigger: z.string().min(1),
  /** Human schedule, when this routine is time-based. */
  schedule: z.string().min(1).optional(),
  /** Prompt configured on the Grok Bot routine. */
  prompt: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  playbook: z.string().min(1),
});

export const GrokBotConnectorDefSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  access: z.enum(["read", "write", "read_write"]).default("read"),
});

export const GrokBotChannelDefSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  posts: z.boolean(),
  listens: z.boolean(),
});

export const GrokBotMemoryKeySchema = z.object({
  key: z.string().min(1),
  stores: z.string().min(1),
});

export const GrokBotHandoffSchema = z.object({
  to: z.string().min(1),
  when: z.string().min(1),
  messageKind: z.enum(["stage-handoff", "consult", "stage-return", "build-result"]),
});

export const GrokBotDefinitionSchema = z
  .object({
    id: z.string().min(1),
    role: AgentRoleSchema,
    displayName: z.string().min(1),
    label: z.string().min(1),
    /** Bots never close finance, security/compliance, release, or customer-proposal gates. */
    mayAutoApproveHumanGate: z.literal(false),
    persona: z.object({
      job: z.string().min(1),
      personality: z.string().min(1),
      memory: z.array(z.string().min(1)).min(1),
      boundaries: z.array(z.string().min(1)).min(1),
    }),
    memoryKeys: z.array(GrokBotMemoryKeySchema).min(1),
    skills: z.array(GrokBotSkillDefSchema).min(1),
    routines: z.array(GrokBotRoutineDefSchema).min(1),
    connectors: z.array(GrokBotConnectorDefSchema).min(1),
    teammates: z.array(z.string().min(1)).default([]),
    channels: z.array(GrokBotChannelDefSchema).min(1),
    handsOffTo: z.array(z.string()).default([]),
    handoffs: z.array(GrokBotHandoffSchema).min(1),
    mandatoryOnEveryChange: z.boolean().optional(),
    markdownPackDir: z.string().min(1),
  })
  .strict();

export const GrokBotCatalogSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  stack: z.string(),
  preserveIterationGate: z.literal("red_team|security"),
  orchestration: z.literal("grok-bot-native"),
  processes: z.array(z.string().min(1)).min(1),
  bots: z.array(z.string().min(1)).min(1),
});

/**
 * Where the bot identity came from.
 * `grok-bot-app` teammates are not xAI Agents API resources and do not take API keys.
 * `xai-agents-api` is only set when POST /v1/agents returns an id.
 */
export const GrokBotProvisionHostSchema = z.enum([
  "none",
  "grok-bot-app",
  "xai-agents-api",
]);

export const GrokBotRegistryStatusSchema = z.enum([
  "not_created",
  /** xAI Agents API returned an id (see liveBotId). */
  "created",
  /** Teammate exists in the Grok Bot app (see grokBotAppAgentId). */
  "created_in_grok_bot_app",
  "skipped_missing_key",
  "error",
]);

export const GrokBotRegistryEntrySchema = z
  .object({
    definitionId: z.string(),
    /**
     * xAI Agents API id from a successful POST /v1/agents response.
     * Never a Grok Bot app agent id, and never invented.
     */
    liveBotId: z.string().nullable(),
    /**
     * Grok Bot app teammate id. Not an xAI Agents API id.
     * Desk must not send this value to api.x.ai.
     */
    grokBotAppAgentId: z.string().uuid().nullable().optional().default(null),
    /** Display name used in the Grok Bot app, when it differs from the local definition. */
    grokBotAppName: z.string().min(1).nullable().optional().default(null),
    host: GrokBotProvisionHostSchema.default("none"),
    createdAt: z.string().nullable(),
    lastError: z.string().nullable().optional(),
    status: GrokBotRegistryStatusSchema,
  })
  .superRefine((entry, ctx) => {
    if (entry.host === "grok-bot-app" && entry.liveBotId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveBotId"],
        message:
          "liveBotId is reserved for xAI Agents API ids; store Grok Bot app ids in grokBotAppAgentId",
      });
    }
    if (
      entry.grokBotAppAgentId &&
      entry.liveBotId &&
      entry.grokBotAppAgentId === entry.liveBotId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveBotId"],
        message: "refusing to store a Grok Bot app agent id as an xAI liveBotId",
      });
    }
    if (entry.status === "created_in_grok_bot_app") {
      if (entry.host !== "grok-bot-app" || !entry.grokBotAppAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message:
            "created_in_grok_bot_app requires host grok-bot-app and grokBotAppAgentId",
        });
      }
    }
    if (entry.status === "created" && entry.host === "grok-bot-app") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "status created is the xAI Agents API outcome; use created_in_grok_bot_app for app teammates",
      });
    }
  });

export const GrokBotRegistrySchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  /** Human-readable provenance. Not an API base URL. */
  note: z.string().optional(),
  entries: z.array(GrokBotRegistryEntrySchema),
});

export type GrokBotSkillDef = z.infer<typeof GrokBotSkillDefSchema>;
export type GrokBotRoutineDef = z.infer<typeof GrokBotRoutineDefSchema>;
export type GrokBotConnectorDef = z.infer<typeof GrokBotConnectorDefSchema>;
export type GrokBotChannelDef = z.infer<typeof GrokBotChannelDefSchema>;
export type GrokBotMemoryKey = z.infer<typeof GrokBotMemoryKeySchema>;
export type GrokBotHandoff = z.infer<typeof GrokBotHandoffSchema>;
export type GrokBotDefinition = z.infer<typeof GrokBotDefinitionSchema>;
export type GrokBotCatalog = z.infer<typeof GrokBotCatalogSchema>;
export type GrokBotProvisionHost = z.infer<typeof GrokBotProvisionHostSchema>;
export type GrokBotRegistryStatus = z.infer<typeof GrokBotRegistryStatusSchema>;
export type GrokBotRegistryEntry = z.infer<typeof GrokBotRegistryEntrySchema>;
export type GrokBotRegistry = z.infer<typeof GrokBotRegistrySchema>;
