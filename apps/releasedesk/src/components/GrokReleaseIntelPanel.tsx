"use client";

import { useState } from "react";
import { MockLabel } from "./MockLabel";

type Intel = {
  mode: string;
  mocked: boolean;
  classify: { category: string; confidence: number };
  extract: { entities: string[]; openQuestions: string[] };
  score: { releaseRisk: number; rationale: string };
  summarize: string;
  trustCheck: { schemaValid: boolean; humanGateStillRequired: true; notes: string[] };
};

export function GrokReleaseIntelPanel({ runId }: { runId: string }) {
  const [intel, setIntel] = useState<Intel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/grok/release-intel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const json = (await res.json()) as { intel?: Intel; error?: string };
      if (!res.ok || !json.intel) throw new Error(json.error ?? "Grok intel failed");
      setIntel(json.intel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Grok API release intel</h2>
        {intel?.mocked ? <MockLabel>MOCK Grok API</MockLabel> : null}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Shipped workflow path — classify / extract / score / summarize. Trust check keeps human gates
        authoritative.
      </p>
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void run()}>
        {busy ? "Calling Grok…" : "Run Grok API intel"}
      </button>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      {intel ? (
        <div className="mt-6 space-y-3 text-sm">
          <p className="font-medium text-rd-ink">
            {intel.classify.category} · confidence {intel.classify.confidence} · risk{" "}
            {intel.score.releaseRisk}/100 · mode {intel.mode}
          </p>
          <p className="text-rd-forest/75">{intel.summarize}</p>
          <p className="text-rd-forest/60">{intel.score.rationale}</p>
          <ul className="list-disc pl-5 text-rd-forest/65">
            {intel.trustCheck.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="text-xs font-bold uppercase tracking-wider text-rd-brass">
            humanGateStillRequired · schemaValid={String(intel.trustCheck.schemaValid)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
