/**
 * Load one pull request and run the OWASP review.
 * No filter on head branch, labels, or request ids. Every diff is reviewed.
 * The manual-review label is an exception flag, not a skip.
 */
import { OWASP_BUILDER_DISPUTE_OPEN, OWASP_REVIEW_HEADING, parseOwaspReviewComment } from "./comment.js";
import { failedOwaspReview, redactSensitive, runOwaspReview } from "./review.js";
import type { BuilderDispute, DiffFile, OwaspReviewReport } from "./types.js";

export const OWASP_MANUAL_REVIEW_LABEL = "security-manual-review";
export const GITHUB_FILES_PAGE_SIZE = 100;
export const GITHUB_FILES_MAX_PAGES = 30;

export type OwaspPrEnv = Record<string, string | undefined>;

type GithubPull = {
  title?: string;
  head?: { sha?: string };
  labels?: Array<{ name?: string }>;
};

type GithubFile = { filename?: string; status?: string; patch?: string };
type GithubComment = { body?: string };

function pullNumber(env: OwaspPrEnv): number | null {
  const value = Number(env.PR_NUMBER);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function headFromEnv(env: OwaspPrEnv): string | null {
  const sha = env.PR_HEAD_SHA?.trim() ?? "";
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha.toLowerCase() : null;
}

export function labelNamesFromEnv(env: OwaspPrEnv): string[] {
  return (env.PR_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

export function manualReviewRequested(labels: readonly string[], env: OwaspPrEnv): {
  requested: boolean;
  reason: string;
} {
  const labeled = labels.some((label) => label === OWASP_MANUAL_REVIEW_LABEL);
  const flag = /^(1|true|yes)$/i.test(env.OWASP_MANUAL_REVIEW?.trim() ?? "");
  if (labeled) {
    return { requested: true, reason: `pull request label ${OWASP_MANUAL_REVIEW_LABEL}` };
  }
  if (flag) return { requested: true, reason: "OWASP_MANUAL_REVIEW is set" };
  return { requested: false, reason: "" };
}

export function extractBuilderDisputes(bodies: readonly string[]): BuilderDispute[] {
  const disputes: BuilderDispute[] = [];
  for (const body of bodies) {
    let searchFrom = 0;
    while (searchFrom < body.length) {
      const open = body.indexOf(OWASP_BUILDER_DISPUTE_OPEN, searchFrom);
      if (open < 0) break;
      const start = open + OWASP_BUILDER_DISPUTE_OPEN.length;
      const end = body.indexOf("-->", start);
      if (end < 0) break;
      searchFrom = end + 3;
      try {
        const parsed = JSON.parse(body.slice(start, end)) as { disputes?: unknown };
        if (!Array.isArray(parsed.disputes)) continue;
        for (const item of parsed.disputes) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          if (record.disputed !== true) continue;
          if (typeof record.id !== "string" || !record.id.trim()) continue;
          disputes.push({
            id: record.id.trim(),
            disputed: true,
            reason: typeof record.reason === "string" ? record.reason : "",
            path: typeof record.path === "string" ? record.path : null,
            line: typeof record.line === "number" && Number.isInteger(record.line) ? record.line : null,
          });
        }
      } catch {
        continue;
      }
    }
  }
  return disputes;
}

export function extractPriorReview(bodies: readonly string[]): {
  headSha: string | null;
  failureRounds: Record<string, number>;
} {
  for (const body of bodies) {
    if (!body.trimStart().startsWith(OWASP_REVIEW_HEADING)) continue;
    const parsed = parseOwaspReviewComment(body);
    if (!parsed.ok || parsed.report.status !== "completed") continue;
    return { headSha: parsed.report.headSha, failureRounds: parsed.report.failureRounds };
  }
  return { headSha: null, failureRounds: {} };
}

async function readJson(res: Response): Promise<unknown> {
  return (await res.json()) as unknown;
}

/**
 * Review the pull request named by the environment.
 * GITHUB_REF, head branch, and request ids are not filters.
 */
export async function owaspReviewForPullRequest(opts?: {
  fetchImpl?: typeof fetch;
  env?: OwaspPrEnv;
  now?: () => Date;
}): Promise<OwaspReviewReport> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const repository = env.GITHUB_REPOSITORY?.trim() || "vishamathur/mvp-releasedesk";
  const pullRequest = pullNumber(env);
  const generatedAt = (opts?.now?.() ?? new Date()).toISOString();
  const token = env.GITHUB_TOKEN?.trim();
  if (!token || !pullRequest) {
    return failedOwaspReview({
      error: "GITHUB_TOKEN or PR_NUMBER is missing, so the diff was not read. Risk was not assessed.",
      repository,
      pullRequest,
      headSha: headFromEnv(env),
      generatedAt,
    });
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "releasedesk-owasp-review",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    const pullRes = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequest}`, { headers });
    if (!pullRes.ok) {
      return failedOwaspReview({
        error: `GitHub pull request request failed (${pullRes.status}). Risk was not assessed.`,
        repository,
        pullRequest,
        headSha: headFromEnv(env),
        generatedAt,
      });
    }
    const pull = (await readJson(pullRes)) as GithubPull;
    const apiSha = pull.head?.sha?.trim() ?? "";
    const headSha =
      headFromEnv(env) ?? (/^[0-9a-f]{7,64}$/i.test(apiSha) ? apiSha.toLowerCase() : null);
    const labels = [
      ...new Set([
        ...labelNamesFromEnv(env),
        ...(pull.labels ?? []).map((label) => label.name?.trim() ?? "").filter(Boolean),
      ]),
    ];
    const manual = manualReviewRequested(labels, env);

    const files: DiffFile[] = [];
    for (let page = 1; page <= GITHUB_FILES_MAX_PAGES; page += 1) {
      const url = `https://api.github.com/repos/${repository}/pulls/${pullRequest}/files?per_page=${GITHUB_FILES_PAGE_SIZE}&page=${page}`;
      const filesRes = await fetchImpl(url, { headers });
      if (!filesRes.ok) {
        return failedOwaspReview({
          error: `GitHub files request failed (${filesRes.status}) on page ${page}. Risk was not assessed.`,
          repository,
          pullRequest,
          headSha,
          generatedAt,
        });
      }
      const batch = (await readJson(filesRes)) as GithubFile[];
      if (!Array.isArray(batch)) {
        return failedOwaspReview({
          error: "GitHub files response was not an array. Risk was not assessed.",
          repository,
          pullRequest,
          headSha,
          generatedAt,
        });
      }
      for (const file of batch) {
        if (!file.filename) continue;
        files.push({
          path: file.filename,
          ...(file.status ? { status: file.status } : {}),
          patch: typeof file.patch === "string" ? file.patch : "",
        });
      }
      if (batch.length < GITHUB_FILES_PAGE_SIZE) break;
    }

    const comments: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const url = `https://api.github.com/repos/${repository}/issues/${pullRequest}/comments?per_page=100&page=${page}`;
      const commentsRes = await fetchImpl(url, { headers });
      if (!commentsRes.ok) {
        return failedOwaspReview({
          error: `GitHub comments request failed (${commentsRes.status}). Risk was not assessed.`,
          repository,
          pullRequest,
          headSha,
          generatedAt,
        });
      }
      const batch = (await readJson(commentsRes)) as GithubComment[];
      if (!Array.isArray(batch)) {
        return failedOwaspReview({
          error: "GitHub comments response was not an array. Risk was not assessed.",
          repository,
          pullRequest,
          headSha,
          generatedAt,
        });
      }
      for (const comment of batch) {
        if (typeof comment.body === "string") comments.push(comment.body);
      }
      if (batch.length < 100) break;
    }

    const prior = extractPriorReview(comments);
    return await runOwaspReview(
      {
        repository,
        pullRequest,
        headSha,
        priorHeadSha: prior.headSha,
        title: pull.title?.trim() || env.PR_TITLE?.trim() || "pull request",
        files,
        manualReview: manual.requested,
        manualReviewReason: manual.reason,
        builderDisputes: extractBuilderDisputes(comments),
        priorFailureRounds: prior.failureRounds,
        generatedAt,
      },
      { fetchImpl, env },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub request failed";
    return failedOwaspReview({
      error: redactSensitive(`GitHub request failed: ${message}. Risk was not assessed.`, [token ?? ""]),
      repository,
      pullRequest,
      headSha: headFromEnv(env),
      generatedAt,
    });
  }
}
