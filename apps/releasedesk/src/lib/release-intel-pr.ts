import { GROK_API_KEY_ENV, MissingCredentialError, resolveAgentGrokApiKey } from "@releasedesk/core";
import {
  runGrokReleaseIntel,
  type GrokReleaseIntelResult,
} from "./grok-release-intel";
import {
  fetchPullRequestFiles,
  resolveDiffTokenBudget,
  selectDiffWithinBudget,
  type PullDiffFile,
} from "./release-intel-diff";

export type ReleaseIntelEnv = Record<string, string | undefined>;

export type ReleaseIntelPrReport = {
  heading: "release-intel v1";
  /** Machine-readable schema id. v1 readers ignore fields they do not know. */
  schema: "release-intel.v2";
  /** The PR head commit this report is about. Null only when neither PR_HEAD_SHA nor GitHub gave one. */
  headSha: string | null;
  headShaSource: "env" | "github" | "unavailable";
  generatedAt: string;
  /** Changed files GitHub returned, and how many of those diffs were sent to Grok. */
  filesTotal: number;
  filesSent: number;
  /** True when the token budget cut the diff, or GitHub's file-list page cap was hit. */
  diffTruncated: boolean;
  diffTokenBudget: number;
  diffTokensUsed: number;
  apiPageCapHit: boolean;
  label: GrokReleaseIntelResult["label"];
  mode: GrokReleaseIntelResult["mode"];
  repository: string;
  pullRequest: number | null;
  title: string;
  changedPaths: string[];
  intel: GrokReleaseIntelResult;
};

type GithubPull = { title?: string; head?: { sha?: string } };

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "releasedesk-release-intel",
  "X-GitHub-Api-Version": "2022-11-28",
};

export async function releaseIntelForPullRequest(opts?: {
  fetchImpl?: typeof fetch;
  env?: ReleaseIntelEnv;
  now?: () => Date;
}): Promise<ReleaseIntelPrReport> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const repository = env.GITHUB_REPOSITORY?.trim() || "vishamathur/mvp-releasedesk";
  const pullNumber = Number(env.PR_NUMBER);
  const pullRequest = Number.isInteger(pullNumber) && pullNumber > 0 ? pullNumber : null;
  if (!resolveAgentGrokApiKey("lead", env as NodeJS.ProcessEnv)) {
    throw new MissingCredentialError(GROK_API_KEY_ENV.lead);
  }

  const token = env.GITHUB_TOKEN?.trim();
  let title = env.PR_TITLE?.trim() || "pull request";
  const envSha = env.PR_HEAD_SHA?.trim();
  let headSha: string | null = envSha && /^[0-9a-f]{7,64}$/i.test(envSha) ? envSha.toLowerCase() : null;
  let headShaSource: ReleaseIntelPrReport["headShaSource"] = headSha ? "env" : "unavailable";
  let files: PullDiffFile[] = [];
  let apiPageCapHit = false;

  if (pullRequest) {
    if (!token) throw new Error("GITHUB_TOKEN is required to fetch the pull request diff");
    const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` };
    const pullRes = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequest}`, { headers });
    if (!pullRes.ok) {
      throw new Error(`GitHub pull request request failed (${pullRes.status})`);
    }
    const pull = (await pullRes.json()) as GithubPull;
    if (pull.title?.trim()) title = pull.title.trim();
    const apiSha = pull.head?.sha?.trim();
    if (!headSha && apiSha && /^[0-9a-f]{7,64}$/i.test(apiSha)) {
      headSha = apiSha.toLowerCase();
      headShaSource = "github";
    }
    const listed = await fetchPullRequestFiles({ fetchImpl, repository, pullRequest, token });
    files = listed.files;
    apiPageCapHit = listed.apiPageCapHit;
  }

  const tokenBudget = resolveDiffTokenBudget(env);
  const diff = selectDiffWithinBudget(files, tokenBudget);
  const intel = await runGrokReleaseIntel(
    {
      repository,
      goal: title,
      pullRequest,
      findings: [],
      diff: pullRequest ? diff : null,
      knownPaths: files.map((file) => file.path),
    },
    { fetchImpl, env },
  );

  return {
    heading: "release-intel v1",
    schema: "release-intel.v2",
    headSha,
    headShaSource,
    generatedAt: (opts?.now?.() ?? new Date()).toISOString(),
    filesTotal: diff.filesTotal,
    filesSent: diff.filesSent,
    diffTruncated: diff.truncated || apiPageCapHit,
    diffTokenBudget: diff.tokenBudget,
    diffTokensUsed: diff.tokensUsed,
    apiPageCapHit,
    label: intel.label,
    mode: intel.mode,
    repository,
    pullRequest,
    title,
    changedPaths: files.map((file) => file.path),
    intel,
  };
}
