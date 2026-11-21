"use client";

import { useEffect, useState } from "react";
import { MockLabel } from "./MockLabel";

type Intel = {
  mode: string;
  label: "MOCK" | "LIVE";
  keyPresent: boolean;
  mocked: boolean;
  classify: { category: string; confidence: number };
  extract: string[];
  score: { level: string; rationale: string };
  summarize: string;
  trustCheck: {
    schemaValid: boolean;
    humanGateStillRequired: true;
    noAutoApprove: true;
    keyEnvVar: string;
    notes: string[];
  };
};

type KeyStatus = {
  keyEnvVar: string;
  keyPresent: boolean;
  liveReady: boolean;
  mockUnlessLive: string;
};

export function GrokReleaseIntelPanel({ runId }: { runId: string }) {
  const [intel, setIntel] = useState<Intel | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/grok/release-intel");
        const json = (await res.json()) as { grokIntel?: KeyStatus };
        if (!cancelled && json.grokIntel) setKeyStatus(json.grokIntel);
      } catch {
        /* room still works; status is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-run once so Challenge Trigger → run page shows MOCK/LIVE without an extra click.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/grok/release-intel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        const json = (await res.json()) as {
          intel?: Intel;
          keyStatus?: KeyStatus;
          error?: string;
        };
        if (!res.ok || !json.intel) throw new Error(json.error ?? "Grok intel failed");
        if (!cancelled) {
          setIntel(json.intel);
          if (json.keyStatus) setKeyStatus(json.keyStatus);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/grok/release-intel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const json = (await res.json()) as {
        intel?: Intel;
        keyStatus?: KeyStatus;
        error?: string;
      };
      if (!res.ok || !json.intel) throw new Error(json.error ?? "Grok intel failed");
      setIntel(json.intel);
      if (json.keyStatus) setKeyStatus(json.keyStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const label = intel?.label ?? (keyStatus?.liveReady ? "LIVE?" : "MOCK");
  const isMock = intel ? intel.mocked || intel.label === "MOCK" : !keyStatus?.liveReady;

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Grok API release intel</h2>
        {isMock ? (
          <MockLabel>MOCK Grok API</MockLabel>
        ) : (
          <span className="rounded-sm bg-rd-brass/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-rd-brass">
            LIVE Grok API
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Shipped path — classify / extract / score / summarize with json_schema. App key{" "}
        <span className="font-mono text-[12px] text-rd-ink">
          {keyStatus?.keyEnvVar ?? "XAI_API_KEY"}
        </span>
        . Per-bot keys are ignored. Trust check keeps human gates with people.
      </p>
      {keyStatus ? (
        <p className="mt-2 text-xs text-rd-forest/55">{keyStatus.mockUnlessLive}</p>
      ) : null}
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void run()}>
        {busy ? "Calling Grok…" : "Re-run Grok API intel"}
      </button>
      {error ? <p className="mt-3 text-sm text-rd-alert">{error}</p> : null}
      {intel ? (
        <div className="mt-6 space-y-3 text-sm">
          <p className="font-medium text-rd-ink">
            {label} · {intel.classify.category} · confidence {intel.classify.confidence} · score{" "}
            {intel.score.level} · mode {intel.mode}
          </p>
          <p className="text-rd-forest/75">{intel.summarize}</p>
          <p className="text-rd-forest/65">Extract: {intel.extract.join("; ") || "—"}</p>
          <p className="text-rd-forest/65">Score: {intel.score.rationale}</p>
          <ul className="list-disc pl-5 text-rd-forest/65">
            {intel.trustCheck.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="text-xs font-bold uppercase tracking-wider text-rd-brass">
            humanGateStillRequired · noAutoApprove · schemaValid=
            {String(intel.trustCheck.schemaValid)} · {intel.trustCheck.keyEnvVar}
          </p>
        </div>
      ) : null}
    </section>
  );
}
