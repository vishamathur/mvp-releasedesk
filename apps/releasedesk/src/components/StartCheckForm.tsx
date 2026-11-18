"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MockLabel } from "./MockLabel";

export function StartCheckForm() {
  const router = useRouter();
  const [goal, setGoal] = useState("On-demand release readiness check");
  const [repository, setRepository] = useState("vishamathur/mvp-releasedesk");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, repository }),
      });
      const body = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? "Check failed");
      router.push(`/runs/${body.runId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Start release check</h2>
        <MockLabel>MOCK specialists + GitHub</MockLabel>
      </div>
      <p className="text-sm text-rd-forest/70">
        Wires to Lead <code className="font-mono text-xs">startOnDemandCheck</code> /{" "}
        <code className="font-mono text-xs">check:release</code> path with stub runners locally.
      </p>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
          Goal
        </span>
        <input
          className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-rd-canopy focus:ring-2 focus:ring-rd-canopy/20"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-rd-forest/60">
          Repository
        </span>
        <input
          className="w-full rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-rd-canopy focus:ring-2 focus:ring-rd-canopy/20"
          value={repository}
          onChange={(e) => setRepository(e.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-rd-alert">{error}</p> : null}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Running orchestrator…" : "Start on-demand check"}
      </button>
    </form>
  );
}
