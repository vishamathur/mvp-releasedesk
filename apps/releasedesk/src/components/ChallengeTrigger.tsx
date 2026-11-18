"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  intel?: { mocked?: boolean; mode?: string; label?: string };
  nhiMissing?: string[];
};

type KeyPreview = {
  grokIntel?: { liveReady?: boolean; keyEnvVar?: string; mockUnlessLive?: string };
  cloudClientMode?: string;
};

export function ChallengeTrigger() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriggerResult | null>(null);
  const [keys, setKeys] = useState<KeyPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/grok/release-intel");
        const json = (await res.json()) as KeyPreview;
        if (!cancelled) setKeys(json);
      } catch {
        /* optional preview */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const grokLive = Boolean(keys?.grokIntel?.liveReady);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Challenge trigger</h2>
        {grokLive ? (
          <span className="rounded-sm bg-rd-brass/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-rd-brass">
            LIVE Grok key present
          </span>
        ) : (
          <MockLabel>MOCK Grok until Lead key set</MockLabel>
        )}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Lead routine end-to-end: specialists → iteration gate → Builder → Coding (ships Grok
        intel) → Testing ∥ Review. Prefer LIVE chips when exclusive NHI keys are present; otherwise
        MOCK (labeled).
      </p>
      {keys?.grokIntel?.mockUnlessLive ? (
        <p className="mt-2 text-xs text-rd-forest/55">{keys.grokIntel.mockUnlessLive}</p>
      ) : null}
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
