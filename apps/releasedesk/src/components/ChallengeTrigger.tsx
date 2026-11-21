"use client";

import { useEffect, useState } from "react";
import { MockLabel } from "./MockLabel";

type TriggerResult = {
  error?: string;
  message?: string;
  orchestratedByDesk?: boolean;
  autoApproved?: boolean;
  trustCheck?: {
    humanGateStillRequired?: boolean;
    noAutoApprove?: boolean;
    keyEnvVar?: string;
  };
  intel?: { mocked?: boolean; mode?: string; label?: string };
};

type KeyPreview = {
  grokIntel?: { liveReady?: boolean; keyEnvVar?: string; mockUnlessLive?: string };
  cloudClientMode?: string;
};

export function ChallengeTrigger() {
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
      const json = (await res.json()) as TriggerResult & { message?: string };
      if (!res.ok) throw new Error(json.error ?? "Trigger failed");
      setResult(json);
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
          <MockLabel>MOCK Grok until XAI_API_KEY is set</MockLabel>
        )}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Desk does not hand work between bots. PID-ER starts in #er-intake and PID-NC starts in
        #new-customer. This button runs the shipped Grok intel call only. Human gates stay pending.
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
          <p>{result.message}</p>
          <p>
            Grok API {result.intel?.label ?? (result.intel?.mocked ? "MOCK" : "LIVE")} · Desk
            orchestrated={String(result.orchestratedByDesk)} · autoApproved=
            {String(result.autoApproved)}
          </p>
          <p>
            trustCheck: humanGateStillRequired=
            {String(result.trustCheck?.humanGateStillRequired)} · noAutoApprove=
            {String(result.trustCheck?.noAutoApprove)} · keyEnv=
            {result.trustCheck?.keyEnvVar}
          </p>
          {result.intel?.mocked ? (
            <MockLabel>MOCK Grok API — XAI_API_KEY missing</MockLabel>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
