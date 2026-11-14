type Checkpoint = {
  id?: string;
  stage: string;
  status: string;
  cycle?: number;
  summary?: string;
  issues?: Array<{ code: string; message: string; remediable: boolean }>;
};

export function CheckpointTrail({ checkpoints }: { checkpoints: Checkpoint[] }) {
  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Checkpoints</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Verification stages after analysis, cloud agents, and remediation.
      </p>
      {checkpoints.length === 0 ? (
        <p className="mt-6 text-sm text-rd-forest/55">No checkpoints recorded.</p>
      ) : (
        <ol className="mt-6 space-y-0">
          {checkpoints.map((cp, idx) => (
            <li key={cp.id ?? `${cp.stage}-${idx}`} className="relative flex gap-4 pb-8 last:pb-0">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-3 w-3 rounded-full ${
                    cp.status === "passed" ? "bg-rd-canopy" : "bg-rd-alert"
                  }`}
                />
                {idx < checkpoints.length - 1 ? (
                  <span className="animate-pulse-line mt-1 w-px flex-1 bg-rd-forest/25" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <p className="font-medium text-rd-ink">{cp.stage.replace(/_/g, " ")}</p>
                  <span className="text-xs font-bold uppercase tracking-wider text-rd-forest/50">
                    {cp.status}
                    {cp.cycle !== undefined ? ` · cycle ${cp.cycle}` : ""}
                  </span>
                </div>
                {cp.summary ? (
                  <p className="mt-1 text-sm text-rd-forest/70">{cp.summary}</p>
                ) : null}
                {cp.issues && cp.issues.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {cp.issues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`} className="text-sm text-rd-alert">
                        {issue.message}
                        {issue.remediable ? (
                          <span className="ml-2 text-xs text-rd-signal">remediable</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
