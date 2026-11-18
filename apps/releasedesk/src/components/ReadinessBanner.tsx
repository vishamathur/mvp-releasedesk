type Props = {
  readiness: string;
  summary: string;
  blockingIssues: string[];
  runId: string;
};

export function ReadinessBanner({ readiness, summary, blockingIssues, runId }: Props) {
  const tone =
    readiness === "ready"
      ? "status-ready"
      : readiness === "needs_human"
        ? "status-needs_human"
        : readiness === "not_ready"
          ? "status-not_ready"
          : "status-unknown";

  return (
    <section className="animate-rise border-b border-rd-forest/10 pb-8">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/55">
        Consolidated readiness
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <h1 className="font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
          {readiness.replace(/_/g, " ")}
        </h1>
        <span className={`rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider ${tone}`}>
          {readiness}
        </span>
      </div>
      <p className="mt-4 max-w-3xl text-rd-forest/80">{summary}</p>
      <p className="mt-3 font-mono text-xs text-rd-forest/50">run · {runId}</p>
      {blockingIssues.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {blockingIssues.map((issue) => (
            <li key={issue} className="text-sm text-rd-alert">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
