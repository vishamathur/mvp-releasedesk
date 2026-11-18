import { nowIso } from "@releasedesk/core";
import type { PrWorkflowClient, PullRequestRecord, TrackedPullRequest } from "./types.js";

export {
  evaluatePrAiFrameworkMergeGate,
  assertPrMergeAllowedForAiFrameworks,
  latestSecurityFindings,
  unresolvedAiFrameworkFindingIds,
} from "./ai-framework-merge.js";

export function parsePullRequestRecord(raw: unknown): PullRequestRecord {
  if (!raw || typeof raw !== "object") return { pullRequests: [] };
  const pullRequests = (raw as { pullRequests?: TrackedPullRequest[] }).pullRequests;
  return { pullRequests: Array.isArray(pullRequests) ? pullRequests : [] };
}

export function parsePrNumberFromUrl(url: string): number | undefined {
  const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Open a PR via the client and return tracked metadata.
 * Never merges.
 */
export async function openAndTrackPullRequest(
  client: PrWorkflowClient,
  input: {
    repository: string;
    title: string;
    body: string;
    head: string;
    base: string;
    source?: TrackedPullRequest["source"];
    labels?: string[];
    /** Draft PRs are exempt from ATLAS/OWASP merge block. */
    draft?: boolean;
  },
): Promise<TrackedPullRequest> {
  const pr = await client.openPullRequest({
    repository: input.repository,
    title: input.title,
    body: input.body,
    head: input.head,
    base: input.base,
    draft: input.draft ?? false,
    labels: input.labels ?? ["releasedesk", "needs-human-approval"],
  });

  return {
    repository: pr.repository,
    prNumber: pr.number,
    url: pr.url,
    head: pr.head,
    base: pr.base,
    title: pr.title,
    openedAt: pr.createdAt,
    clientMode: client.mode,
    source: input.source ?? "lead",
    autoMerge: false,
    humanMergeGateRequired: true,
    draft: pr.draft,
  };
}

/**
 * Track an existing PR URL (e.g. from Builder proposedPrUrl) without opening a new one.
 */
export async function trackExistingPullRequest(
  client: PrWorkflowClient,
  input: {
    repository: string;
    prUrl: string;
    head?: string;
    base?: string;
    title?: string;
    source?: TrackedPullRequest["source"];
  },
): Promise<TrackedPullRequest> {
  const prNumber = parsePrNumberFromUrl(input.prUrl);
  if (prNumber === undefined) {
    throw new Error(`Cannot parse PR number from URL: ${input.prUrl}`);
  }

  const pr = await client.getPullRequest(input.repository, prNumber);
  return {
    repository: pr.repository,
    prNumber: pr.number,
    url: pr.url,
    head: input.head ?? pr.head,
    base: input.base ?? pr.base,
    title: input.title ?? pr.title,
    openedAt: pr.createdAt || nowIso(),
    clientMode: client.mode,
    source: input.source ?? "builder",
    autoMerge: false,
    humanMergeGateRequired: true,
    draft: pr.draft,
  };
}

/**
 * Poll PR status. Does not merge.
 */
export async function pollTrackedPullRequest(
  client: PrWorkflowClient,
  tracked: TrackedPullRequest,
): Promise<TrackedPullRequest> {
  const status = await client.getPullRequestStatus(tracked.repository, tracked.prNumber);
  return {
    ...tracked,
    lastStatus: status,
    autoMerge: false,
    humanMergeGateRequired: true,
    draft: tracked.draft,
  };
}

/**
 * Explicit guard — always throws. Use Lead human merge gate instead.
 * Also enforces ATLAS/OWASP open-for-review merge block when `aiFrameworkGate` provided.
 */
export async function refuseAutoMerge(
  client: PrWorkflowClient,
  tracked: TrackedPullRequest,
  opts?: {
    /** When set, open-for-review PRs with unresolved ATLAS/OWASP findings cannot merge. */
    assertAiFrameworkMerge?: () => void;
  },
): Promise<never> {
  if (opts?.assertAiFrameworkMerge) {
    opts.assertAiFrameworkMerge();
  }
  return client.mergePullRequest(tracked.repository, tracked.prNumber);
}
