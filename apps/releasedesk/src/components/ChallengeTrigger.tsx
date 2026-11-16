"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MockLabel } from "./MockLabel";

type Chip = "LIVE" | "MOCK";

type TriggerResult = {
  runUrl?: string;
  error?: string;
  chips?: { grokApi?: Chip; cursorCloud?: Chip };
  compliancePct?: number;
  trustCheck?: {
    humanGateStillRequired?: boolean;
    noAutoApprove?: boolean;
    keyEnvVar?: string;
  };
  intel?: { mocked?: boolean; mode?: string };
  nhiMissing?: string[];
};

export function ChallengeTrigger() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriggerResult | null>(null);

  async function trigger() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/bots/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "SpaceXAI challenge: Northwind KYC release readiness",
          repository: "vishamathur/mvp-releasedesk",
        }),
      });
      const json = (await res.json()) as TriggerResult;
      if (!res.ok || !json.runUrl) throw new Error(json.error ?? "Trigger failed");
      setResult(json);
      // Brief pause so chips are visible before navigation.
      await new Promise((r) => setTimeout(r, 600));
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
        Lead routine end-to-end: specialists → iteration gate → Cursor→Grok API intel. Prefer LIVE
        chips when exclusive NHI keys are present; otherwise MOCK (labeled).
      </p>
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void trigger()}>
        {busy ? "Running…" : "Trigger Grok Bot workflow"}
      </button>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      {result ? (
        <div className="mt-4 space-y-2 text-sm text-rd-forest/75">
          <p>
            Chips:{" "}
            <span className="font-medium text-rd-ink">
              Grok API {result.chips?.grokApi ?? (result.intel?.mocked ? "MOCK" : "LIVE")}
            </span>
            {" · "}
            <span className="font-medium text-rd-ink">
              Cursor Cloud {result.chips?.cursorCloud ?? "MOCK"}
            </span>
            {result.compliancePct != null ? ` · compliance ~${result.compliancePct}%` : null}
          </p>
          <p>
            trustCheck: humanGateStillRequired=
            {String(result.trustCheck?.humanGateStillRequired)} · noAutoApprove=
            {String(result.trustCheck?.noAutoApprove)} · keyEnv=
            {result.trustCheck?.keyEnvVar}
          </p>
          {(result.chips?.grokApi === "MOCK" || result.intel?.mocked) && (
            <MockLabel>MOCK Grok API — exclusive key missing</MockLabel>
          )}
        </div>
      ) : null}
    </section>
  );
}
