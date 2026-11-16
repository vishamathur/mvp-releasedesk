"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChallengeTrigger() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bots/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "SpaceXAI challenge: Northwind KYC release readiness",
          repository: "vishamathur/mvp-releasedesk",
        }),
      });
      const json = (await res.json()) as { runUrl?: string; error?: string };
      if (!res.ok || !json.runUrl) throw new Error(json.error ?? "Trigger failed");
      router.push(json.runUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Challenge trigger</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Lead routine end-to-end: specialists → iteration gate → Grok API intel path. Most demo time
        lives here.
      </p>
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void trigger()}>
        {busy ? "Running…" : "Trigger Grok Bot workflow"}
      </button>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
    </section>
  );
}
