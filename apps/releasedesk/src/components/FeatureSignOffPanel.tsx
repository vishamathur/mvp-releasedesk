"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SignOffItem = {
  id: string;
  label: string;
  description: string;
  signedOff: boolean;
  signedOffBy?: string;
  notes?: string;
};

type Checklist = {
  id: string;
  kind: string;
  status: string;
  feature: {
    title: string;
    summary: string;
    sourceAgent: string;
    branch?: string;
    prUrl?: string;
  };
  items: SignOffItem[];
  completedBy?: string;
};

export function FeatureSignOffPanel({
  runId,
  checklists,
}: {
  runId: string;
  checklists: Checklist[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signItem(checklistId: string, itemId: string) {
    setBusy(`${checklistId}:${itemId}`);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/feature-signoffs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checklistId,
          itemId,
          signedOffBy: "developer@northwind",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-off failed");
    } finally {
      setBusy(null);
    }
  }

  async function signAll(checklistId: string) {
    setBusy(`${checklistId}:all`);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/feature-signoffs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checklistId,
          signOffAll: true,
          signedOffBy: "developer@northwind",
          notes: "All checklist items verified in Release Desk UI",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-off failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Feature sign-off checklists</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Every AI-produced feature must be manually verified item-by-item before merge and release
        gates can clear. Never auto-signed.
      </p>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      {checklists.length === 0 ? (
        <p className="mt-6 text-sm text-rd-forest/55">
          No AI-produced features detected on this run — only merge/release gates apply.
        </p>
      ) : (
        <ul className="mt-6 space-y-6">
          {checklists.map((checklist) => {
            const signed = checklist.items.filter((i) => i.signedOff).length;
            return (
              <li
                key={checklist.id}
                className="rounded-md border border-rd-forest/15 bg-white/50 px-4 py-4 backdrop-blur-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
                      {checklist.kind.replace(/_/g, " ")} checklist
                    </p>
                    <p className="mt-1 font-medium text-rd-ink">{checklist.feature.title}</p>
                    <p className="mt-1 text-sm text-rd-forest/70">{checklist.feature.summary}</p>
                    <p className="mt-2 font-mono text-[11px] text-rd-forest/40">
                      source={checklist.feature.sourceAgent}
                      {checklist.feature.branch ? ` · ${checklist.feature.branch}` : ""}
                      {checklist.feature.prUrl ? ` · ${checklist.feature.prUrl}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                      checklist.status === "completed"
                        ? "status-ready"
                        : checklist.status === "in_progress"
                          ? "status-needs_human"
                          : "status-needs_human"
                    }`}
                  >
                    {checklist.status} · {signed}/{checklist.items.length}
                  </span>
                </div>

                <ul className="mt-4 space-y-3">
                  {checklist.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-start justify-between gap-3 border-t border-rd-forest/10 pt-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-rd-ink">{item.label}</p>
                        <p className="mt-0.5 text-xs text-rd-forest/65">{item.description}</p>
                        {item.signedOff ? (
                          <p className="mt-1 text-xs text-rd-forest/55">
                            Signed{item.signedOffBy ? ` by ${item.signedOffBy}` : ""}
                            {item.notes ? ` — ${item.notes}` : ""}
                          </p>
                        ) : null}
                      </div>
                      {item.signedOff ? (
                        <span className="text-xs font-bold uppercase tracking-wider text-rd-forest/50">
                          Done
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary !px-3 !py-1.5 text-xs"
                          disabled={busy !== null}
                          onClick={() => void signItem(checklist.id, item.id)}
                        >
                          {busy === `${checklist.id}:${item.id}` ? "Signing…" : "Sign off"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {checklist.status !== "completed" ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy !== null}
                      onClick={() => void signAll(checklist.id)}
                    >
                      {busy === `${checklist.id}:all`
                        ? "Signing all…"
                        : "Sign off entire checklist"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-rd-forest/65">
                    Checklist complete
                    {checklist.completedBy ? ` — ${checklist.completedBy}` : ""}. Merge/release
                    gates may proceed.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
