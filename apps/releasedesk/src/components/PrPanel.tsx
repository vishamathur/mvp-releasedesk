import { MockLabel } from "./MockLabel";

type Pr = {
  prNumber: number;
  url: string;
  title?: string;
  state?: string;
  autoMerge?: boolean;
  lastStatus?: {
    checkStatus?: string;
    state?: string;
    polledAt?: string;
  } | null;
};

export function PrPanel({ pullRequests, prClientMode }: { pullRequests: Pr[]; prClientMode: string }) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Pull requests</h2>
        {prClientMode === "mock" ? <MockLabel>MOCK GitHub</MockLabel> : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Tracked for status only — Release Desk never auto-merges.
      </p>
      {pullRequests.length === 0 ? (
        <p className="mt-6 text-sm text-rd-forest/55">No pull requests tracked in this run.</p>
      ) : (
        <ul className="mt-6 divide-y divide-rd-forest/10 border-y border-rd-forest/10">
          {pullRequests.map((pr) => (
            <li key={pr.prNumber} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div>
                <p className="font-medium text-rd-ink">
                  #{pr.prNumber}
                  {pr.title ? ` · ${pr.title}` : ""}
                </p>
                <a
                  href={pr.url}
                  className="mt-1 block break-all text-sm text-rd-canopy underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {pr.url}
                </a>
                <p className="mt-2 text-xs text-rd-forest/55">
                  checks: {pr.lastStatus?.checkStatus ?? "n/a"} · autoMerge: false
                </p>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-rd-forest/55">
                {pr.state ?? pr.lastStatus?.state ?? "tracked"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
