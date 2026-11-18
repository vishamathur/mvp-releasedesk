"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type GateView = {
  uiStatus: "pending" | "open" | "blocked";
  state: {
    iterationId: string;
    title: string;
    context: {
      provider: string;
      mcpContext?: string;
      findingsRouting: string;
    };
    approvals: Array<{ kind: string; approvedBy: string; approvedAt: string }>;
    rejected?: { by: string; at: string; note?: string };
  };
  gate: {
    summary: string;
    nextMainStage: string;
    releaseBlockingCount: number;
    remediationSideQueue: Array<{ id: string; summary: string; nonBlocking: true }>;
    phases: {
      pre_release: { summary: string; releaseBlockingCount: number };
      post_remediation: { summary: string; releaseBlockingCount: number };
    };
    iterationProceed: {
      canProceed: boolean;
      hasRedTeamApproval: boolean;
      hasSecurityApproval: boolean;
      blockingIssue?: string;
    };
  };
};

export function IterationApprovalGate({
  runId,
  iterationGate,
}: {
  runId: string;
  iterationGate: GateView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uiStatus, state, gate } = iterationGate;

  async function decide(
    decision: "approved" | "rejected",
    kind?: "red_team" | "security",
  ) {
    setBusy(`${decision}:${kind ?? "reject"}`);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/iteration-gate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(kind !== undefined ? { kind } : {}),
          decidedBy: "delivery-manager@northwind",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Iteration gate decision failed");
    } finally {
      setBusy(null);
    }
  }

  const statusClass =
    uiStatus === "open"
      ? "status-ready"
      : uiStatus === "blocked"
        ? "status-not_ready"
        : "status-needs_human";

  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Iteration approval gate</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Hard gate: every code iteration needs <strong>red team</strong> or{" "}
        <strong>security</strong> approval before it can proceed. Collapsed single pass
        (pre-release + post-remediation); remediation is a non-blocking side-queue.
      </p>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}

      <div className="mt-6 rounded-md border border-rd-forest/15 bg-white/50 px-4 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
              {state.context.provider} · collapsed gate
            </p>
            <p className="mt-1 font-medium text-rd-ink">{state.title}</p>
            <p className="mt-1 font-mono text-[11px] text-rd-forest/40">
              {state.iterationId}
            </p>
          </div>
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${statusClass}`}
          >
            {uiStatus}
          </span>
        </div>

        <p className="mt-3 text-sm text-rd-forest/75">{gate.summary}</p>

        <dl className="mt-4 grid gap-2 text-sm text-rd-forest/70 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">Pre-release</dt>
            <dd>{gate.phases.pre_release.summary}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">
              Post-remediation
            </dt>
            <dd>{gate.phases.post_remediation.summary}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">MCP context</dt>
            <dd>{state.context.mcpContext ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">
              Next main stage
            </dt>
            <dd className="font-mono text-xs">{gate.nextMainStage}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">
              Red team approval
            </dt>
            <dd>{gate.iterationProceed.hasRedTeamApproval ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-rd-forest/45">
              Security approval
            </dt>
            <dd>{gate.iterationProceed.hasSecurityApproval ? "yes" : "no"}</dd>
          </div>
        </dl>

        {gate.remediationSideQueue.length > 0 ? (
          <div className="mt-4 border-t border-rd-forest/10 pt-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-brass">
              Remediation side-queue (non-blocking)
            </p>
            <ul className="mt-2 space-y-1 text-sm text-rd-forest/70">
              {gate.remediationSideQueue.map((item) => (
                <li key={item.id}>
                  {item.summary}{" "}
                  <span className="font-mono text-[11px] text-rd-forest/40">
                    nonBlocking={String(item.nonBlocking)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {gate.iterationProceed.blockingIssue ? (
          <p className="mt-4 text-sm text-rd-alert">{gate.iterationProceed.blockingIssue}</p>
        ) : null}

        {state.rejected ? (
          <p className="mt-3 text-sm text-rd-forest/65">
            Rejected by {state.rejected.by}
            {state.rejected.note ? ` — ${state.rejected.note}` : ""}
          </p>
        ) : null}

        {state.approvals.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-rd-forest/65">
            {state.approvals.map((a) => (
              <li key={`${a.kind}-${a.approvedAt}`}>
                {a.kind} approved by {a.approvedBy}
              </li>
            ))}
          </ul>
        ) : null}

        {uiStatus === "pending" || uiStatus === "blocked" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => void decide("approved", "red_team")}
            >
              {busy === "approved:red_team" ? "Approving…" : "Approve as red team"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => void decide("approved", "security")}
            >
              {busy === "approved:security" ? "Approving…" : "Approve as security"}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={() => void decide("rejected")}
            >
              {busy === "rejected:reject" ? "Rejecting…" : "Reject sign-off"}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-rd-forest/65">
            Gate open — iteration may proceed to human merge/release.
          </p>
        )}
      </div>
    </section>
  );
}
