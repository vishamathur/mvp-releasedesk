import { MockLabel } from "./MockLabel";

type Check = {
  id: string;
  name: string;
  status: string;
  source: string;
  detail: string;
  mocked?: boolean;
};

type Gate = {
  id: string;
  status: string;
  summary: string;
  blocking?: boolean;
  checks: Check[];
};

export function TestGatePanel({ gates }: { gates: Gate[] }) {
  const latest = gates[gates.length - 1];
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Automated test gate</h2>
        {latest?.checks.some((c) => c.mocked) ? <MockLabel>MOCK suite runner</MockLabel> : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Continuous feedback before human merge/release — workspace suite, Cloud Agent tests, PR
        checks.
      </p>
      {!latest ? (
        <p className="mt-6 text-sm text-rd-forest/55">No test gate evaluated for this run.</p>
      ) : (
        <div className="mt-6">
          <p className="text-sm font-medium text-rd-ink">
            Status:{" "}
            <span
              className={
                latest.status === "passed" ? "text-rd-canopy" : "text-rd-alert"
              }
            >
              {latest.status}
            </span>
            {latest.blocking ? " · blocking" : ""}
          </p>
          <p className="mt-1 text-sm text-rd-forest/70">{latest.summary}</p>
          <ul className="mt-4 divide-y divide-rd-forest/10 border-y border-rd-forest/10">
            {latest.checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-rd-ink">{c.name}</p>
                  <p className="mt-1 text-sm text-rd-forest/65">{c.detail}</p>
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-rd-forest/55">
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
