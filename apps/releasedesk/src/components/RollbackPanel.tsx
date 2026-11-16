import { MockLabel } from "./MockLabel";

type Step = {
  order: number;
  action: string;
  owner: string;
  automated: boolean;
  detail: string;
};

type Plan = {
  id: string;
  status: string;
  riskLevel: string;
  rationale: string;
  previousReleaseTag: string;
  currentHead: string;
  steps: Step[];
  mocked?: boolean;
};

export function RollbackPanel({ plans }: { plans: Plan[] }) {
  const latest = plans[plans.length - 1];
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Rollback plan</h2>
        {latest?.mocked ? <MockLabel>MOCK prior tag</MockLabel> : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Adaptability recipe if release must be reversed — never auto-executed.
      </p>
      {!latest ? (
        <p className="mt-6 text-sm text-rd-forest/55">No rollback plan for this run.</p>
      ) : (
        <div className="mt-6 space-y-4">
          <p className="text-sm font-medium text-rd-ink">
            {latest.status} · risk {latest.riskLevel} · prior {latest.previousReleaseTag} ←{" "}
            {latest.currentHead}
          </p>
          <p className="text-sm text-rd-forest/70">{latest.rationale}</p>
          <ol className="divide-y divide-rd-forest/10 border-y border-rd-forest/10">
            {latest.steps.map((s) => (
              <li key={s.order} className="py-3">
                <p className="text-sm font-medium text-rd-ink">
                  {s.order}. {s.action}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wider text-rd-forest/55">
                  owner {s.owner} · {s.automated ? "automated" : "manual"}
                </p>
                <p className="mt-1 text-sm text-rd-forest/65">{s.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
