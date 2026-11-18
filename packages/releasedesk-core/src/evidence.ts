import { z } from "zod";
import { EvidenceIdSchema, createEvidenceId, nowIso } from "./ids.js";
import { MockMetaSchema } from "./mock.js";

export const EvidenceKindSchema = z.enum([
  "finding",
  "artifact",
  "log",
  "diff",
  "test_result",
  "policy_ref",
  "advisory",
  "pr_ref",
  "other",
]);

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceItemSchema = z.object({
  id: EvidenceIdSchema,
  kind: EvidenceKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Agent or system that produced this evidence. */
  source: z.string().min(1),
  createdAt: z.string().datetime(),
  /** Optional URI / path / commit SHA / PR URL. */
  uri: z.string().optional(),
  /** Arbitrary structured payload (keep small; prefer uri for large artifacts). */
  data: z.record(z.unknown()).optional(),
  /** Present when evidence comes from a mocked integration. */
  mock: MockMetaSchema.optional(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export type CreateEvidenceInput = {
  kind: EvidenceKind;
  title: string;
  summary: string;
  source: string;
  uri?: string;
  data?: Record<string, unknown>;
  mock?: z.infer<typeof MockMetaSchema>;
  id?: string;
  createdAt?: string;
};

export function createEvidenceItem(input: CreateEvidenceInput): EvidenceItem {
  return EvidenceItemSchema.parse({
    id: input.id ?? createEvidenceId(),
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    source: input.source,
    createdAt: input.createdAt ?? nowIso(),
    ...(input.uri !== undefined ? { uri: input.uri } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.mock !== undefined ? { mock: input.mock } : {}),
  });
}
