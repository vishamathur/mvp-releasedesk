import { z } from "zod";
import { AgentRoleSchema } from "./agents/roles.js";
import { nowIso } from "./ids.js";

/**
 * Standing Release Desk principle: every AI-produced new feature requires a
 * developer checklist sign-off (item-by-item manual verification) before
 * merge/release gates can clear readiness.
 */

/** Stable checklist item ids — developer must verify each before sign-off. */
export const FeatureSignOffItemIdSchema = z.enum([
  "intent_match",
  "manual_code_review",
  "behavior_verified",
  "tests_adequate",
  "security_basics",
  "no_secrets",
]);

export type FeatureSignOffItemId = z.infer<typeof FeatureSignOffItemIdSchema>;

export const DEFAULT_FEATURE_SIGNOFF_ITEM_DEFS: ReadonlyArray<{
  id: FeatureSignOffItemId;
  label: string;
  description: string;
}> = [
  {
    id: "intent_match",
    label: "Matches intended change",
    description:
      "The AI-produced change matches the requested feature / remediation goal; no unexpected scope.",
  },
  {
    id: "manual_code_review",
    label: "Manual code review",
    description:
      "A developer has read the AI-written code and understands what it does.",
  },
  {
    id: "behavior_verified",
    label: "Behavior verified",
    description:
      "The feature was exercised manually (or via targeted checks) and behaves as expected.",
  },
  {
    id: "tests_adequate",
    label: "Tests adequate",
    description:
      "Automated and/or manual tests cover the change; failures were investigated.",
  },
  {
    id: "security_basics",
    label: "Security basics checked",
    description:
      "AuthZ, input validation, and sensitive-data handling look correct for this change.",
  },
  {
    id: "no_secrets",
    label: "No secrets or credentials",
    description:
      "No API keys, passwords, tokens, or private data were introduced in code or fixtures.",
  },
];

/** Evidence that a specialist / Cloud Agent introduced a new feature. */
export const FeatureArtifactSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Agent path that produced the feature (builder, coding cloud agent, etc.). */
  sourceAgent: z.union([AgentRoleSchema, z.literal("coding"), z.string().min(1)]),
  taskId: z.string().optional(),
  branch: z.string().optional(),
  prUrl: z.string().url().optional(),
  workItemKind: z.enum(["coding", "testing", "review"]).optional(),
  createdAt: z.string().datetime(),
});

export type FeatureArtifact = z.infer<typeof FeatureArtifactSchema>;

export const FeatureSignOffItemSchema = z.object({
  id: FeatureSignOffItemIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  signedOff: z.boolean().default(false),
  signedOffAt: z.string().datetime().optional(),
  signedOffBy: z.string().optional(),
  notes: z.string().optional(),
});

export type FeatureSignOffItem = z.infer<typeof FeatureSignOffItemSchema>;

export const FeatureSignOffChecklistStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);

export type FeatureSignOffChecklistStatus = z.infer<
  typeof FeatureSignOffChecklistStatusSchema
>;

/**
 * Per-feature human checklist. Kind `feature_review` / `new_feature` marks this
 * as distinct from run-level merge/release approval gates.
 */
export const FeatureSignOffChecklistSchema = z.object({
  id: z.string().min(1),
  /** Explicit gate kind for UI / readiness — not merge/release. */
  kind: z.enum(["feature_review", "new_feature"]).default("feature_review"),
  status: FeatureSignOffChecklistStatusSchema.default("pending"),
  feature: FeatureArtifactSchema,
  items: z.array(FeatureSignOffItemSchema).min(1),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  completedBy: z.string().optional(),
});

export type FeatureSignOffChecklist = z.infer<typeof FeatureSignOffChecklistSchema>;

export const FeatureSignOffRecordSchema = z.object({
  checklists: z.array(FeatureSignOffChecklistSchema).default([]),
});

export type FeatureSignOffRecord = z.infer<typeof FeatureSignOffRecordSchema>;

let featureSeq = 0;
let checklistSeq = 0;

export function createFeatureArtifactId(seed?: string): string {
  featureSeq += 1;
  return `feature_${seed ?? featureSeq}_${Date.now()}`;
}

export function createDefaultSignOffItems(): FeatureSignOffItem[] {
  return DEFAULT_FEATURE_SIGNOFF_ITEM_DEFS.map((d) => ({
    id: d.id,
    label: d.label,
    description: d.description,
    signedOff: false,
  }));
}

export function createFeatureSignOffChecklist(
  feature: FeatureArtifact,
  opts?: { kind?: "feature_review" | "new_feature"; id?: string },
): FeatureSignOffChecklist {
  checklistSeq += 1;
  return FeatureSignOffChecklistSchema.parse({
    id: opts?.id ?? `feature_signoff_${checklistSeq}_${Date.now()}`,
    kind: opts?.kind ?? "feature_review",
    status: "pending",
    feature,
    items: createDefaultSignOffItems(),
    createdAt: nowIso(),
  });
}

export function isChecklistComplete(checklist: FeatureSignOffChecklist): boolean {
  return checklist.items.length > 0 && checklist.items.every((i) => i.signedOff);
}

export function getIncompleteChecklists(
  record: FeatureSignOffRecord | undefined,
): FeatureSignOffChecklist[] {
  return (record?.checklists ?? []).filter((c) => !isChecklistComplete(c));
}

export function allFeatureSignOffsComplete(
  record: FeatureSignOffRecord | undefined,
): boolean {
  const checklists = record?.checklists ?? [];
  if (checklists.length === 0) return true;
  return checklists.every(isChecklistComplete);
}

export function deriveChecklistStatus(
  items: readonly FeatureSignOffItem[],
): FeatureSignOffChecklistStatus {
  if (items.length === 0) return "pending";
  const signed = items.filter((i) => i.signedOff).length;
  if (signed === 0) return "pending";
  if (signed === items.length) return "completed";
  return "in_progress";
}

export function signOffChecklistItem(
  checklist: FeatureSignOffChecklist,
  itemId: FeatureSignOffItemId,
  opts?: { signedOffBy?: string; notes?: string; signedOff?: boolean },
): FeatureSignOffChecklist {
  const signedOff = opts?.signedOff ?? true;
  const idx = checklist.items.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error(`Checklist item ${itemId} not found on ${checklist.id}`);
  const existing = checklist.items[idx]!;
  if (existing.signedOff && signedOff) {
    throw new Error(`Checklist item ${itemId} is already signed off`);
  }

  const nextItems = checklist.items.map((item, i) => {
    if (i !== idx) return item;
    if (!signedOff) {
      return {
        id: item.id,
        label: item.label,
        description: item.description,
        signedOff: false,
      };
    }
    return {
      ...item,
      signedOff: true,
      signedOffAt: nowIso(),
      ...(opts?.signedOffBy !== undefined ? { signedOffBy: opts.signedOffBy } : {}),
      ...(opts?.notes !== undefined ? { notes: opts.notes } : {}),
    };
  });

  const status = deriveChecklistStatus(nextItems);
  const completedBy =
    status === "completed"
      ? (opts?.signedOffBy ??
        nextItems.find((i) => i.signedOffBy)?.signedOffBy)
      : undefined;

  return FeatureSignOffChecklistSchema.parse({
    ...checklist,
    items: nextItems,
    status,
    ...(status === "completed"
      ? {
          completedAt: nowIso(),
          ...(completedBy !== undefined ? { completedBy } : {}),
        }
      : { completedAt: undefined, completedBy: undefined }),
  });
}

/** Sign off every remaining item (explicit human/demo action — never automatic). */
export function signOffEntireChecklist(
  checklist: FeatureSignOffChecklist,
  opts?: { signedOffBy?: string; notes?: string },
): FeatureSignOffChecklist {
  let next = checklist;
  for (const item of checklist.items) {
    if (item.signedOff) continue;
    next = signOffChecklistItem(next, item.id, opts);
  }
  return next;
}

export function parseFeatureSignOffRecord(raw: unknown): FeatureSignOffRecord {
  if (!raw || typeof raw !== "object") return { checklists: [] };
  const parsed = FeatureSignOffRecordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const checklists = (raw as { checklists?: unknown }).checklists;
  return { checklists: Array.isArray(checklists) ? (checklists as FeatureSignOffChecklist[]) : [] };
}
