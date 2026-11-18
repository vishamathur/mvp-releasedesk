import { createMockMeta, formatMockNote, nowIso } from "@releasedesk/core";
import type {
  OpenPullRequestInput,
  PrMetadata,
  PrStatusSnapshot,
  PrWorkflowClient,
} from "./types.js";

export type MockPrClientOptions = {
  /** Starting PR number (default 9000). */
  startNumber?: number;
  /** Simulated check status for polls (default success). */
  checkStatus?: PrStatusSnapshot["checkStatus"];
};

/**
 * In-memory MOCK GitHub PR client — used when GH_TOKEN / GITHUB_TOKEN are absent.
 * All results are labeled MOCK: and auto-merge is always refused.
 */
export function createMockPrClient(options: MockPrClientOptions = {}): PrWorkflowClient {
  let nextNumber = options.startNumber ?? 9000;
  const store = new Map<string, PrMetadata>();
  const checkStatus = options.checkStatus ?? "success";

  const key = (repository: string, n: number) => `${repository}#${n}`;

  const mockMeta = (note: string) =>
    createMockMeta("github-pr", note);

  return {
    mode: "mock",

    async openPullRequest(input: OpenPullRequestInput): Promise<PrMetadata> {
      const number = nextNumber++;
      const [owner, repo] = splitRepo(input.repository);
      const at = nowIso();
      const pr: PrMetadata = {
        number,
        url: `https://github.com/${owner}/${repo}/pull/${number}`,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        repository: `${owner}/${repo}`,
        state: "open",
        draft: input.draft ?? false,
        mergeable: true,
        autoMerge: false,
        createdAt: at,
        updatedAt: at,
        labels: input.labels ?? ["releasedesk", "needs-human-approval"],
        mocked: true,
        mock: mockMeta("Opened MOCK pull request; no GitHub API call"),
      };
      store.set(key(pr.repository, number), pr);
      return pr;
    },

    async getPullRequest(repository: string, prNumber: number): Promise<PrMetadata> {
      const [owner, repo] = splitRepo(repository);
      const full = `${owner}/${repo}`;
      const existing = store.get(key(full, prNumber));
      if (existing) return existing;

      const at = nowIso();
      const fabricated: PrMetadata = {
        number: prNumber,
        url: `https://github.com/${full}/pull/${prNumber}`,
        title: formatMockNote(`Tracked PR #${prNumber}`),
        body: formatMockNote("Fabricated PR metadata for polling without prior open"),
        head: "MOCK:head",
        base: "main",
        repository: full,
        state: "open",
        draft: false,
        mergeable: true,
        autoMerge: false,
        createdAt: at,
        updatedAt: at,
        labels: ["releasedesk"],
        mocked: true,
        mock: mockMeta("Fabricated MOCK PR metadata"),
      };
      store.set(key(full, prNumber), fabricated);
      return fabricated;
    },

    async getPullRequestStatus(repository: string, prNumber: number): Promise<PrStatusSnapshot> {
      const pr = await this.getPullRequest(repository, prNumber);
      return {
        prNumber,
        url: pr.url,
        state: pr.state,
        checkStatus,
        checkSummary: formatMockNote(
          `MOCK CI status=${checkStatus}; human merge gate required`,
        ),
        mergeable: pr.mergeable,
        humanMergeGateRequired: true,
        autoMerge: false,
        polledAt: nowIso(),
        mocked: true,
        mock: mockMeta("Polled MOCK PR status"),
        raw: { provider: "mock-github" },
      };
    },

    async mergePullRequest(_repository: string, prNumber: number): Promise<never> {
      throw new Error(
        `Release Desk refuses auto-merge for PR #${prNumber}. Record human approval on the Lead merge gate instead.`,
      );
    },
  };
}

function splitRepo(repository: string): [string, string] {
  const cleaned = repository
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository: ${repository}`);
  }
  return [parts[0], parts[1]];
}
