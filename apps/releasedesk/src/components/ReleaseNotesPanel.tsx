import { MockLabel } from "./MockLabel";

type Highlight = {
  path: string;
  changeType: string;
  impact: string;
  summary: string;
};

type NotesPkg = {
  id: string;
  status: string;
  title: string;
  bodyMarkdown: string;
  overallImpact: string;
  commitsReviewed: number;
  highlights: Highlight[];
  mocked?: boolean;
  baseRef?: string;
  headRef?: string;
};

export function ReleaseNotesPanel({ packages }: { packages: NotesPkg[] }) {
  const latest = packages[packages.length - 1];
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Release notes</h2>
        {latest?.mocked ? <MockLabel>MOCK draft</MockLabel> : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Consolidated from Change Analyst for human review before release.
      </p>
      {!latest ? (
        <p className="mt-6 text-sm text-rd-forest/55">No release notes package generated.</p>
      ) : (
        <div className="mt-6 space-y-4">
          <div>
            <p className="font-medium text-rd-ink">{latest.title}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-rd-forest/55">
              {latest.status} · impact {latest.overallImpact} · {latest.commitsReviewed} commits
              {latest.baseRef && latest.headRef
                ? ` · ${latest.baseRef}…${latest.headRef}`
                : ""}
            </p>
          </div>
          {latest.highlights.length > 0 ? (
            <ul className="divide-y divide-rd-forest/10 border-y border-rd-forest/10">
              {latest.highlights.slice(0, 8).map((h) => (
                <li key={`${h.path}-${h.changeType}`} className="py-3">
                  <p className="text-sm font-medium text-rd-ink">
                    <code className="text-rd-canopy">{h.path}</code> · {h.changeType} · {h.impact}
                  </p>
                  <p className="mt-1 text-sm text-rd-forest/65">{h.summary}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-rd-forest/5 p-4 text-xs leading-relaxed text-rd-forest/80">
            {latest.bodyMarkdown}
          </pre>
        </div>
      )}
    </section>
  );
}
