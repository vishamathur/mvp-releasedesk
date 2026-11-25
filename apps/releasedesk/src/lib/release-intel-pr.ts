import {
  runGrokReleaseIntel,
  type GrokReleaseIntelResult,
} from "./grok-release-intel";

export type ReleaseIntelEnv = Record<string, string | undefined>;

export type ReleaseIntelPrReport = {
  heading: "release-intel v1";
  label: GrokReleaseIntelResult["label"];
  mode: GrokReleaseIntelResult["mode"];
  repository: string;
  pullRequest: number | null;
  title: string;
  changedPaths: string[];
  intel: GrokReleaseIntelResult;
};

type GithubPull = { title?: string };
type GithubFile = { filename?: string };

export async function releaseIntelForPullRequest(opts?: {
  fetchImpl?: typeof fetch;
  env?: ReleaseIntelEnv;
}): Promise<ReleaseIntelPrReport> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const repository = env.GITHUB_REPOSITORY?.trim() || "vishamathur/mvp-releasedesk";
  const pullNumber = Number(env.PR_NUMBER);
  const pullRequest = Number.isInteger(pullNumber) && pullNumber > 0 ? pullNumber : null;
  const token = env.GITHUB_TOKEN?.trim();
  let title = env.PR_TITLE?.trim() || "pull request";
  let changedPaths: string[] = [];

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
      findings: changedPaths.map((filePath) => ({ source: "github", text: filePath })),
    },
    { fetchImpl, env },
  );

  return {
    heading: "release-intel v1",
    label: intel.label,
    mode: intel.mode,
    repository,
    pullRequest,
    title,
    changedPaths,
    intel,
  };
}
