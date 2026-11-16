"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Gate = {
  id: string;
  kind: string;
  status: string;
  reason: string;
  decidedBy?: string;
  notes?: string;
};

export function ApprovalGates({ runId, gates }: { runId: string; gates: Gate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(gateId: string, decision: "approved" | "rejected") {
    setBusy(`${gateId}:${decision}`);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateId,
          decision,
          decidedBy: "delivery-manager@northwind",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Merge & release gates</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Run-level merge and release decisions (after feature checklist sign-offs). Approving merge
        never auto-merges.
      </p>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      <ul className="mt-6 space-y-5">
        {gates.map((gate) => (
          <li
            key={gate.id}
            className="rounded-md border border-rd-forest/15 bg-white/50 px-4 py-4 backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
                  {gate.kind} gate
                </p>
                <p className="mt-1 font-medium text-rd-ink">{gate.reason}</p>
                <p className="mt-1 font-mono text-[11px] text-rd-forest/40">{gate.id}</p>
              </div>
              <span
                className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                  gate.status === "approved"
                    ? "status-ready"
                    : gate.status === "rejected"
                      ? "status-not_ready"
                      : "status-needs_human"
                }`}
              >
                {gate.status}
              </span>
            </div>
            {gate.status === "pending" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy !== null}
                  onClick={() => void decide(gate.id, "approved")}
                >
                  {busy === `${gate.id}:approved` ? "Approving…" : `Approve ${gate.kind}`}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy !== null}
                  onClick={() => void decide(gate.id, "rejected")}
                >
                  {busy === `${gate.id}:rejected` ? "Rejecting…" : `Reject ${gate.kind}`}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-rd-forest/65">
                {gate.decidedBy ? `By ${gate.decidedBy}` : "Decided"}
                {gate.notes ? ` — ${gate.notes}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
