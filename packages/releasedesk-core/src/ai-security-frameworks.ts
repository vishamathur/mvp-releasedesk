import { z } from "zod";
import { nowIso } from "./ids.js";

/**
 * MITRE ATLAS + OWASP LLM Top 10 — hard Security guardrails for AI-written code
 * and AI components.
 *
 * Any finding mapped to these frameworks fails the Security check and blocks
 * repository PR **merge** (open-for-review PRs only; drafts are not blocked)
 * and release until resolved or explicitly human-waived.
 */

/** OWASP Top 10 for Large Language Model Applications (2025). */
export const OWASP_LLM_TOP_10 = [
  { id: "LLM01", name: "Prompt Injection" },
  { id: "LLM02", name: "Sensitive Information Disclosure" },
  { id: "LLM03", name: "Supply Chain" },
  { id: "LLM04", name: "Data and Model Poisoning" },
  { id: "LLM05", name: "Improper Output Handling" },
  { id: "LLM06", name: "Excessive Agency" },
  { id: "LLM07", name: "System Prompt Leakage" },
  { id: "LLM08", name: "Vector and Embedding Weaknesses" },
  { id: "LLM09", name: "Misinformation" },
  { id: "LLM10", name: "Unbounded Consumption" },
] as const;

export type OwaspLlmTop10Id = (typeof OWASP_LLM_TOP_10)[number]["id"];

export const OwaspLlmTop10IdSchema = z.enum([
  "LLM01",
  "LLM02",
  "LLM03",
  "LLM04",
  "LLM05",
  "LLM06",
  "LLM07",
  "LLM08",
  "LLM09",
  "LLM10",
]);

/**
 * MITRE ATLAS technique subset used as Release Desk Security reference ids.
 * Full catalog: https://atlas.mitre.org/
 */
export const ATLAS_TECHNIQUES = [
  { id: "AML.T0051", name: "LLM Prompt Injection" },
  { id: "AML.T0054", name: "LLM Jailbreak" },
  { id: "AML.T0010", name: "AI Supply Chain Compromise" },
  { id: "AML.T0024", name: "Exfiltration via AI Inference API" },
  { id: "AML.T0048", name: "Fake AI Content / Misinformation" },
  { id: "AML.T0050", name: "Command and Scripting via LLM" },
  { id: "AML.T0043", name: "Craft Adversarial Data" },
  { id: "AML.T0015", name: "Full ML Model Access / Excessive Agency" },
] as const;

export type AtlasTechniqueId = (typeof ATLAS_TECHNIQUES)[number]["id"];

export const AtlasTechniqueIdSchema = z.enum([
  "AML.T0051",
  "AML.T0054",
  "AML.T0010",
  "AML.T0024",
  "AML.T0048",
  "AML.T0050",
  "AML.T0043",
  "AML.T0015",
]);

export const SecurityFrameworkIdSchema = z.enum(["mitre_atlas", "owasp_llm_top_10"]);
export type SecurityFrameworkId = z.infer<typeof SecurityFrameworkIdSchema>;

export const SecurityFrameworkMappingSchema = z.object({
  framework: SecurityFrameworkIdSchema,
  /** ATLAS technique id or OWASP LLM Top 10 id. */
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
  /** Always true — mapped findings are hard Security failures. */
  hardFail: z.literal(true).default(true),
});

export type SecurityFrameworkMapping = z.infer<typeof SecurityFrameworkMappingSchema>;

/** Explicit human waiver for a framework-mapped finding (never auto-waived). */
export const AiFrameworkWaiverSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1),
  waivedBy: z.string().min(1),
  waivedAt: z.string().datetime(),
  reason: z.string().min(1),
  frameworks: z.array(SecurityFrameworkIdSchema).min(1),
});

export type AiFrameworkWaiver = z.infer<typeof AiFrameworkWaiverSchema>;

export const AiFrameworkWaiverRecordSchema = z.object({
  waivers: z.array(AiFrameworkWaiverSchema).default([]),
});

export type AiFrameworkWaiverRecord = z.infer<typeof AiFrameworkWaiverRecordSchema>;

export function parseAiFrameworkWaiverRecord(raw: unknown): AiFrameworkWaiverRecord {
  if (!raw || typeof raw !== "object") return { waivers: [] };
  const waivers = (raw as { waivers?: AiFrameworkWaiver[] }).waivers;
  return { waivers: Array.isArray(waivers) ? waivers : [] };
}

export function createAiFrameworkWaiver(input: {
  findingId: string;
  waivedBy: string;
  reason: string;
  frameworks: SecurityFrameworkId[];
  id?: string;
}): AiFrameworkWaiver {
  return AiFrameworkWaiverSchema.parse({
    id: input.id ?? `waiver_${input.findingId}_${Date.now()}`,
    findingId: input.findingId,
    waivedBy: input.waivedBy,
    waivedAt: nowIso(),
    reason: input.reason,
    frameworks: input.frameworks,
  });
}

export type FrameworkMappedFindingLike = {
  id: string;
  releaseBlocking?: boolean;
  hardFail?: boolean;
  frameworkMappings?: Array<{
    framework: string;
    categoryId: string;
    categoryName?: string;
    hardFail?: boolean;
  }>;
};

/** True when a finding carries ATLAS and/or OWASP LLM Top 10 mappings. */
export function isFrameworkMappedFinding(finding: FrameworkMappedFindingLike): boolean {
  return (finding.frameworkMappings?.length ?? 0) > 0;
}

/**
 * Unresolved hard-fail findings = framework-mapped and not human-waived.
 * These fail Security and block open-for-review PR merge + release.
 */
export function listUnresolvedFrameworkFindings(
  findings: readonly FrameworkMappedFindingLike[],
  waivers: AiFrameworkWaiverRecord | undefined,
): FrameworkMappedFindingLike[] {
  const waived = new Set((waivers?.waivers ?? []).map((w) => w.findingId));
  return findings.filter((f) => isFrameworkMappedFinding(f) && !waived.has(f.id));
}

export type AiFrameworkMergeGate = {
  /** Hard guardrails always apply to Security check outcomes. */
  hardGuardrails: true;
  /** Unresolved framework-mapped findings remain. */
  hasUnresolvedFindings: boolean;
  unresolvedFindingIds: string[];
  /**
   * Blocks repository PR merge when unresolved findings exist AND the PR is
   * open for review (not draft). Draft PRs are not merge-blocked by ATLAS/OWASP.
   */
  blocksPrMerge: boolean;
  /** Draft PRs are exempt from the merge block (findings still fail Security). */
  draftExempt: boolean;
  prDraft: boolean | null;
  prOpenForReview: boolean;
  blockingIssue?: string;
};

/**
 * Evaluate whether ATLAS/OWASP findings must block repository PR merge.
 * Draft PRs are never merge-blocked by these findings; open-for-review PRs are.
 */
export function evaluateAiFrameworkMergeGate(input: {
  findings: readonly FrameworkMappedFindingLike[];
  waivers?: AiFrameworkWaiverRecord;
  /** When true, PR is draft — merge block does not apply. */
  prDraft?: boolean | null;
  /** When false/closed/merged, merge block is N/A for an open review PR. */
  prState?: "open" | "closed" | "merged" | null;
}): AiFrameworkMergeGate {
  const unresolved = listUnresolvedFrameworkFindings(input.findings, input.waivers);
  const hasUnresolved = unresolved.length > 0;
  const prDraft = input.prDraft ?? null;
  const isDraft = prDraft === true;
  const prOpenForReview =
    !isDraft && (input.prState === undefined || input.prState === null || input.prState === "open");

  const blocksPrMerge = hasUnresolved && prOpenForReview && !isDraft;

  let blockingIssue: string | undefined;
  if (hasUnresolved && isDraft) {
    blockingIssue = undefined; // draft exempt from merge block; Security still fails separately
  } else if (blocksPrMerge) {
    blockingIssue = `Security: ${unresolved.length} unresolved MITRE ATLAS / OWASP LLM Top 10 finding(s) block PR merge (open for review) — resolve or human-waive before merge`;
  } else if (hasUnresolved) {
    blockingIssue = `Security: ${unresolved.length} unresolved MITRE ATLAS / OWASP LLM Top 10 finding(s) — resolve or human-waive`;
  }

  return {
    hardGuardrails: true,
    hasUnresolvedFindings: hasUnresolved,
    unresolvedFindingIds: unresolved.map((f) => f.id),
    blocksPrMerge,
    draftExempt: isDraft,
    prDraft,
    prOpenForReview,
    ...(blockingIssue !== undefined ? { blockingIssue } : {}),
  };
}

/** Assert merge is refused when open-for-review PR has unresolved framework findings. */
export function assertAiFrameworkPrMergeAllowed(gate: AiFrameworkMergeGate): void {
  if (gate.blocksPrMerge) {
    throw new Error(
      gate.blockingIssue ??
        "Release Desk blocks PR merge: unresolved MITRE ATLAS / OWASP LLM Top 10 findings on an open-for-review PR",
    );
  }
}

export function owaspCategory(id: OwaspLlmTop10Id): { id: OwaspLlmTop10Id; name: string } {
  const row = OWASP_LLM_TOP_10.find((r) => r.id === id)!;
  return { id: row.id, name: row.name };
}

export function atlasTechnique(id: AtlasTechniqueId): { id: AtlasTechniqueId; name: string } {
  const row = ATLAS_TECHNIQUES.find((r) => r.id === id)!;
  return { id: row.id, name: row.name };
}

export function mappingForOwasp(id: OwaspLlmTop10Id): SecurityFrameworkMapping {
  const cat = owaspCategory(id);
  return SecurityFrameworkMappingSchema.parse({
    framework: "owasp_llm_top_10",
    categoryId: cat.id,
    categoryName: cat.name,
    hardFail: true,
  });
}

export function mappingForAtlas(id: AtlasTechniqueId): SecurityFrameworkMapping {
  const cat = atlasTechnique(id);
  return SecurityFrameworkMappingSchema.parse({
    framework: "mitre_atlas",
    categoryId: cat.id,
    categoryName: cat.name,
    hardFail: true,
  });
}
