import { nowIso } from "@releasedesk/core";
import type {
  OpenPullRequestInput,
  PrCheckStatus,
  PrMetadata,
  PrState,
  PrStatusSnapshot,
  PrWorkflowClient,
} from "./types.js";

export type RealPrClientOptions = {
  token: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  apiBase?: string;
};

type GhPull = {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  head: { ref: string };
  base: { ref: string };
  state: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  created_at: string;
  updated_at: string;
  labels?: Array<{ name: string }>;
};

type GhCombinedStatus = {
  state: string;
  statuses?: Array<{ context?: string; state?: string; description?: string }>;
  sha?: string;
};

/**
 * Real GitHub PR client — enabled when GH_TOKEN or GITHUB_TOKEN is present.
 * mergePullRequest always throws (never auto-merge).
 */
export function createRealPrClient(options: RealPrClientOptions): PrWorkflowClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBase = options.apiBase ?? "https://api.github.com";

  async function gh<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  function mapPr(repository: string, data: GhPull): PrMetadata {
    const state: PrState = data.merged ? "merged" : data.state === "closed" ? "closed" : "open";
    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
      body: data.body ?? "",
      head: data.head.ref,
      base: data.base.ref,
      repository,
      state,
      draft: data.draft ?? false,
      mergeable: data.mergeable ?? null,
      autoMerge: false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      labels: (data.labels ?? []).map((l) => l.name),
    };
  }

  function mapCheckStatus(state: string): PrCheckStatus {
    switch (state) {
      case "success":
        return "success";
      case "failure":
      case "error":
        return state;
      case "pending":
        return "pending";
      default:
        return "neutral";
    }
  }

  return {
    mode: "real",

    async openPullRequest(input: OpenPullRequestInput): Promise<PrMetadata> {
      const [owner, repo] = splitRepo(input.repository);
      const data = await gh<GhPull>("POST", `/repos/${owner}/${repo}/pulls`, {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft ?? false,
      });

      if (input.labels?.length) {
        try {
          await gh("POST", `/repos/${owner}/${repo}/issues/${data.number}/labels`, {
            labels: input.labels,
          });
        } catch {
          // Labels are best-effort; PR already exists.
        }
      }

      return mapPr(`${owner}/${repo}`, data);
    },

    async getPullRequest(repository: string, prNumber: number): Promise<PrMetadata> {
      const [owner, repo] = splitRepo(repository);
      const data = await gh<GhPull>("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
      return mapPr(`${owner}/${repo}`, data);
    },

    async getPullRequestStatus(repository: string, prNumber: number): Promise<PrStatusSnapshot> {
      const pr = await this.getPullRequest(repository, prNumber);
      const [owner, repo] = splitRepo(repository);
      // Resolve head SHA via PR, then combined status.
      const prRaw = await gh<GhPull & { head: { ref: string; sha: string } }>(
        "GET",
        `/repos/${owner}/${repo}/pulls/${prNumber}`,
      );
      const sha = prRaw.head.sha;
      let combined: GhCombinedStatus = { state: "pending" };
      try {
        combined = await gh<GhCombinedStatus>(
          "GET",
          `/repos/${owner}/${repo}/commits/${sha}/status`,
        );
      } catch {
        combined = { state: "pending" };
      }

      return {
        prNumber,
        url: pr.url,
        state: pr.state,
        checkStatus: mapCheckStatus(combined.state),
        checkSummary: `GitHub combined status=${combined.state}; human merge gate required`,
        mergeable: pr.mergeable,
        humanMergeGateRequired: true,
        autoMerge: false,
        polledAt: nowIso(),
        raw: { sha, combinedState: combined.state, statuses: combined.statuses },
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
