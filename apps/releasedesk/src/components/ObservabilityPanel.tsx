import { MockLabel } from "./MockLabel";

type ObsEvent = {
  id: string;
  kind: string;
  message: string;
  at: string;
  mocked?: boolean;
};

type Summary = {
  mode: string;
  eventCount: number;
  durationMs?: number;
  remediationCycles?: number;
  testGateStatus?: string;
  readiness?: string;
  mocked?: boolean;
  kinds?: Record<string, number>;
};

export function ObservabilityPanel({
  summary,
  events,
}: {
  summary?: Summary | null;
  events: ObsEvent[];
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Observability</h2>
        {(summary?.mocked ?? summary?.mode === "mock") ? (
          <MockLabel>MOCK sink</MockLabel>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Structured run metrics for inspect-and-adapt — duration, gates, remediation cycles.
      </p>
      {!summary || summary.eventCount === 0 ? (
        <p className="mt-6 text-sm text-rd-forest/55">No observability events recorded.</p>
      ) : (
        <div className="mt-6 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-rd-forest/55">Events</dt>
              <dd className="mt-1 font-medium text-rd-ink">{summary.eventCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-rd-forest/55">Duration</dt>
              <dd className="mt-1 font-medium text-rd-ink">
                {summary.durationMs !== undefined ? `${summary.durationMs} ms` : "n/a"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-rd-forest/55">Test gate</dt>
              <dd className="mt-1 font-medium text-rd-ink">{summary.testGateStatus ?? "n/a"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-rd-forest/55">Readiness</dt>
              <dd className="mt-1 font-medium text-rd-ink">{summary.readiness ?? "n/a"}</dd>
            </div>
          </dl>
          <ul className="max-h-56 divide-y divide-rd-forest/10 overflow-auto border-y border-rd-forest/10">
            {[...events].reverse().slice(0, 10).map((e) => (
              <li key={e.id} className="py-2">
                <p className="text-xs font-bold uppercase tracking-wider text-rd-brass">{e.kind}</p>
                <p className="mt-1 text-sm text-rd-forest/75">{e.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
