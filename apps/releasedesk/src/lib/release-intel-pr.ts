import {
  RELEASE_INTEL_FINDINGS_LIMIT,
  runGrokReleaseIntel,
  type GrokReleaseIntelResult,
} from "./grok-release-intel";

export type ReleaseIntelEnv = Record<string, string | undefined>;

export type ReleaseIntelPrReport = {
  heading: "release-intel v1";
  /** Machine-readable schema id. Builder checks it before reading the fields. */
  schema: "release-intel.v1";
  /** The PR head commit this report is about. Null only when neither PR_HEAD_SHA nor GitHub gave one. */
  headSha: string | null;
  headShaSource: "env" | "github" | "unavailable";
  generatedAt: string;
  /** Changed files GitHub returned (first page, up to 100) and how many were sent to Grok. */
  filesTotal: number;
  filesSent: number;
  label: GrokReleaseIntelResult["label"];
  mode: GrokReleaseIntelResult["mode"];
  repository: string;
  pullRequest: number | null;
  title: string;
  changedPaths: string[];
  intel: GrokReleaseIntelResult;
};

type GithubPull = { title?: string; head?: { sha?: string } };
type GithubFile = { filename?: string };

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
  const token = env.GITHUB_TOKEN?.trim();
  let title = env.PR_TITLE?.trim() || "pull request";
  let changedPaths: string[] = [];
  const envSha = env.PR_HEAD_SHA?.trim();
  let headSha: string | null = envSha && /^[0-9a-f]{7,64}$/i.test(envSha) ? envSha.toLowerCase() : null;
  let headShaSource: ReleaseIntelPrReport["headShaSource"] = headSha ? "env" : "unavailable";

  if (token && pullRequest) {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "releasedesk-release-intel",
    };
    try {
      const [pullRes, filesRes] = await Promise.all([
        fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequest}`, { headers }),
        fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequest}/files?per_page=100`, {
          headers,
        }),
      ]);
      if (pullRes.ok) {
        const pull = (await pullRes.json()) as GithubPull;
        if (pull.title?.trim()) title = pull.title.trim();
        const apiSha = pull.head?.sha?.trim();
        if (!headSha && apiSha && /^[0-9a-f]{7,64}$/i.test(apiSha)) {
          headSha = apiSha.toLowerCase();
          headShaSource = "github";
        }
      }
      if (filesRes.ok) {
        const files = (await filesRes.json()) as GithubFile[];
        changedPaths = files.map((file) => file.filename).filter((name): name is string => Boolean(name));
      }
    } catch {
      title = title || "pull request";
    }
  }

  const intel = await runGrokReleaseIntel(
    {
      repository,
      goal: title,
      findings: changedPaths
        .slice(0, RELEASE_INTEL_FINDINGS_LIMIT)
        .map((filePath) => ({ source: "github", text: filePath })),
    },
    { fetchImpl, env },
  );

  return {
    heading: "release-intel v1",
    schema: "release-intel.v1",
    headSha,
    headShaSource,
    generatedAt: (opts?.now?.() ?? new Date()).toISOString(),
    filesTotal: changedPaths.length,
    filesSent: Math.min(changedPaths.length, RELEASE_INTEL_FINDINGS_LIMIT),
    label: intel.label,
    mode: intel.mode,
    repository,
    pullRequest,
    title,
    changedPaths,
    intel,
  };
}
