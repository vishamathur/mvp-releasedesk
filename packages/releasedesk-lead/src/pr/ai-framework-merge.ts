import {
  assertAiFrameworkPrMergeAllowed,
  evaluateAiFrameworkMergeGate,
  listUnresolvedFrameworkFindings,
  parseAiFrameworkWaiverRecord,
  type AiFrameworkMergeGate,
  type AiFrameworkWaiverRecord,
  type FrameworkMappedFindingLike,
} from "@releasedesk/core";
import type { TaskRecord } from "@releasedesk/core";
import type { TrackedPullRequest } from "./types.js";

/**
 * ATLAS / OWASP LLM Top 10 merge gate for repository PRs.
 *
 * - Unresolved framework-mapped findings → block merge when PR is **open for review**
 * - **Draft PRs are not merge-blocked** by these findings (Security still fails)
 * - Human waiver clears the merge block for waived finding ids
 */

export function latestSecurityFindings(
  tasks: readonly TaskRecord[],
): FrameworkMappedFindingLike[] {
  const securityTasks = tasks.filter((t) => t.agentRole === "security");
  if (securityTasks.length === 0) return [];
  let latest = securityTasks[0]!;
  for (const t of securityTasks) {
    const prev = latest.completedAt ?? latest.updatedAt;
    const next = t.completedAt ?? t.updatedAt;
    if (next >= prev) latest = t;
  }
  const findings = latest.output?.findings;
  return Array.isArray(findings) ? (findings as FrameworkMappedFindingLike[]) : [];
}

export function evaluatePrAiFrameworkMergeGate(input: {
  tasks: readonly TaskRecord[];
  waivers?: AiFrameworkWaiverRecord | unknown;
  /** Tracked PR — draft status drives exemption. */
  pullRequest?: Pick<TrackedPullRequest, "lastStatus"> & {
    draft?: boolean;
    lastStatus?: { state?: string } | undefined;
  } | null;
  /** Explicit draft flag when PR metadata is known. */
  prDraft?: boolean | null;
  prState?: "open" | "closed" | "merged" | null;
}): AiFrameworkMergeGate {
  const findings = latestSecurityFindings(input.tasks);
  const waivers = parseAiFrameworkWaiverRecord(input.waivers);
  const draft =
    input.prDraft ??
    input.pullRequest?.draft ??
    null;
  const state =
    input.prState ??
    (input.pullRequest?.lastStatus?.state as "open" | "closed" | "merged" | undefined) ??
    "open";

  return evaluateAiFrameworkMergeGate({
    findings,
    waivers,
    prDraft: draft,
    prState: state,
  });
}

/**
 * Refuse repository PR merge when open-for-review PR has unresolved ATLAS/OWASP findings.
 * Draft PRs pass through (not blocked by this gate).
 */
export function assertPrMergeAllowedForAiFrameworks(input: {
  tasks: readonly TaskRecord[];
  waivers?: AiFrameworkWaiverRecord | unknown;
  prDraft?: boolean | null;
  prState?: "open" | "closed" | "merged" | null;
  pullRequest?: Parameters<typeof evaluatePrAiFrameworkMergeGate>[0]["pullRequest"];
}): AiFrameworkMergeGate {
  const gate = evaluatePrAiFrameworkMergeGate(input);
  assertAiFrameworkPrMergeAllowed(gate);
  return gate;
}

export function unresolvedAiFrameworkFindingIds(
  tasks: readonly TaskRecord[],
  waivers?: AiFrameworkWaiverRecord | unknown,
): string[] {
  return listUnresolvedFrameworkFindings(
    latestSecurityFindings(tasks),
    parseAiFrameworkWaiverRecord(waivers),
  ).map((f) => f.id);
}
