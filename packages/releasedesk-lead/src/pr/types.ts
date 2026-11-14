import type { MockMeta } from "@releasedesk/core";

/**
 * GitHub PR workflow types for Milestone 6.
 * Never auto-merges — merge requires explicit human approval via Lead gates.
 */

export type PrClientMode = "mock" | "real";

export type PrState = "open" | "closed" | "merged";

export type PrCheckStatus = "pending" | "success" | "failure" | "error" | "neutral";

export type PrMetadata = {
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  repository: string;
  state: PrState;
  draft: boolean;
  mergeable: boolean | null;
  /** Always false for Release Desk — human gate required. */
  autoMerge: false;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  mocked?: boolean;
  mock?: MockMeta;
};

export type PrStatusSnapshot = {
  prNumber: number;
  url: string;
  state: PrState;
  checkStatus: PrCheckStatus;
  checkSummary: string;
  mergeable: boolean | null;
  /** Always true — Lead human merge gate is authoritative. */
  humanMergeGateRequired: true;
  /** Always false — Release Desk never auto-merges. */
  autoMerge: false;
  polledAt: string;
  mocked?: boolean;
  mock?: MockMeta;
  raw?: Record<string, unknown>;
};

export type OpenPullRequestInput = {
  repository: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  labels?: string[];
};

export type PrWorkflowClient = {
  readonly mode: PrClientMode;
  openPullRequest(input: OpenPullRequestInput): Promise<PrMetadata>;
  getPullRequest(repository: string, prNumber: number): Promise<PrMetadata>;
  getPullRequestStatus(repository: string, prNumber: number): Promise<PrStatusSnapshot>;
  /**
   * Intentionally refuses — Release Desk never auto-merges.
   * Callers must route merge decisions through Lead human approval gates.
   */
  mergePullRequest(repository: string, prNumber: number): Promise<never>;
};

export type TrackedPullRequest = {
  repository: string;
  prNumber: number;
  url: string;
  head: string;
  base: string;
  title: string;
  openedAt: string;
  lastStatus?: PrStatusSnapshot;
  clientMode: PrClientMode;
  source: "builder" | "lead" | "external";
  autoMerge: false;
  humanMergeGateRequired: true;
};

export type PullRequestRecord = {
  pullRequests: TrackedPullRequest[];
};
