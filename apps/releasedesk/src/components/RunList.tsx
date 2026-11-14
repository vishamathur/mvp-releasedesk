import Link from "next/link";
import type { RunListItem } from "@/lib/types";
import { MockLabel } from "./MockLabel";

export function RunList({ runs }: { runs: RunListItem[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-rd-forest/60">
        No runs yet. Start an on-demand check or load a demo scenario.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rd-forest/10 border-y border-rd-forest/10">
      {runs.map((run) => (
        <li key={run.runId}>
          <Link
            href={`/runs/${run.runId}`}
            className="flex flex-wrap items-start justify-between gap-3 py-4 transition hover:bg-white/40"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-rd-ink">{run.goal}</p>
                {run.mockIntegrations ? <MockLabel /> : null}
              </div>
              <p className="mt-1 text-sm text-rd-forest/65">{run.repository}</p>
              <p className="mt-1 font-mono text-[11px] text-rd-forest/40">{run.runId}</p>
              {run.scenarioLabel ? (
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-rd-brass">
                  {run.scenarioLabel}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <span
                className={`inline-flex rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                  run.readiness === "ready"
                    ? "status-ready"
                    : run.readiness === "needs_human"
                      ? "status-needs_human"
                      : run.readiness === "not_ready"
                        ? "status-not_ready"
                        : "status-unknown"
                }`}
              >
                {run.readiness}
              </span>
              <p className="mt-2 text-xs text-rd-forest/50">
                {run.pendingApprovals} pending · {run.checkpointCount} checkpoints · {run.prCount}{" "}
                PRs
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
