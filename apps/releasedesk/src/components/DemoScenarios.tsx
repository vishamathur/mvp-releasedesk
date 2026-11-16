"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DemoScenarioMeta } from "@/lib/types";

export function DemoScenarios({ scenarios }: { scenarios: DemoScenarioMeta[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, mode: "live" | "fixture") {
    setBusy(`${id}:${mode}`);
    setError(null);
    try {
      const res = await fetch("/api/demos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: id, mode }),
      });
      const body = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? "Demo failed");
      router.push(`/runs/${body.runId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo failed");
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Demo scenarios</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Live mode re-runs the Lead orchestrator with scenario runners. Fixture mode loads a
        recorded run-context file from a prior demo generation.
      </p>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      <ul className="mt-6 grid gap-6 md:grid-cols-2">
        {scenarios.map((s) => (
          <li key={s.id} className="border-t border-rd-forest/15 pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">{s.id}</p>
            <h3 className="mt-2 font-display text-xl text-rd-ink">{s.title}</h3>
            <p className="mt-2 text-sm text-rd-forest/70">{s.blurb}</p>
            <p className="mt-2 text-xs text-rd-forest/50">Expected: {s.expectedReadiness}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => void run(s.id, "live")}
              >
                {busy === `${s.id}:live`
                  ? "Running…"
                  : s.id === "iteration-approval-gate"
                    ? "Open gate demo"
                    : "Run live"}
              </button>
              {s.id !== "iteration-approval-gate" ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void run(s.id, "fixture")}
                >
                  {busy === `${s.id}:fixture` ? "Loading…" : "Load fixture"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
