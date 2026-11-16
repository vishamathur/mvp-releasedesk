"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";
import { MockLabel } from "@/components/MockLabel";
import type { ControlPlaneSnapshot } from "@/lib/control-plane";

export default function ControlPlanePage() {
  const [snap, setSnap] = useState<ControlPlaneSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/control-plane");
        const body = (await res.json()) as ControlPlaneSnapshot & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load control plane");
        setSnap(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load control plane");
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
            Enterprise SDLC control plane
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
            Release Desk
          </h1>
          <p className="mt-3 max-w-2xl text-rd-forest/75">
            One runnable path for SpaceXAI: Grok Bots Lead+specialists → Cursor cloud agents ship
            real code that calls Grok API → human gates. Intake, ATLAS/OWASP, iteration gate,
            merge/release, multi-customer portfolio, token efficiency, NHI keys.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={pending} onClick={load}>
              {pending ? "Refreshing…" : snap ? "Re-run control plane" : "Run control plane"}
            </button>
            <Link href="/desk" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Showcase desk
            </Link>
            <MockLabel>MOCK without exclusive keys</MockLabel>
          </div>
        </div>

        {error ? (
          <p className="mt-8 text-sm text-[color:var(--rd-alert)]" role="alert">
            {error}
          </p>
        ) : null}

        {snap ? (
          <>
            <section className="mt-14">
              <h2 className="font-display text-2xl text-rd-ink">Pipeline stages</h2>
              <ol className="mt-8 space-y-8">
                {snap.stages.map((stage) => (
                  <li key={stage.id} className="border-t border-rd-mist/80 pt-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-display text-xl text-rd-ink">{stage.label}</h3>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-rd-forest/55">
                        {stage.status}
                      </span>
                    </div>
                    <p className="mt-2 text-rd-forest/75">{stage.summary}</p>
                    {stage.detail ? (
                      <p className="mt-2 text-sm text-rd-forest/55">{stage.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-16 grid gap-12 md:grid-cols-2">
              <div>
                <h2 className="font-display text-2xl text-rd-ink">ATLAS / OWASP</h2>
                <p className="mt-2 text-sm text-rd-forest/70">
                  {snap.atlasOwasp.findingCount} findings · blocking{" "}
                  {snap.atlasOwasp.gate.releaseBlockingCount}
                </p>
                <p className="mt-3 text-sm text-rd-forest/65">
                  ATLAS: {snap.atlasOwasp.atlasTags.join(", ") || "—"}
                </p>
                <p className="mt-1 text-sm text-rd-forest/65">
                  OWASP: {snap.atlasOwasp.owaspTags.join(", ") || "—"}
                </p>
              </div>
              <div>
                <h2 className="font-display text-2xl text-rd-ink">Iteration gate</h2>
                <p className="mt-2 text-sm text-rd-forest/70">
                  {snap.iterationGate.canProceed
                    ? "Open — red_team|security satisfied"
                    : snap.iterationGate.blockingIssue}
                </p>
                <p className="mt-3 text-sm text-rd-forest/55">
                  Live approve/reject on each run page after Challenge Trigger.
                </p>
              </div>
            </section>

            <section className="mt-16">
              <h2 className="font-display text-2xl text-rd-ink">Grok API ship</h2>
              <p className="mt-2 font-mono text-xs text-rd-forest/55">{snap.ship.path}</p>
              <ul className="mt-6 space-y-3 text-sm text-rd-forest/75">
                {(
                  [
                    ["classify", snap.ship.specialistIntel.classify],
                    ["extract", snap.ship.specialistIntel.extract],
                    ["score", snap.ship.specialistIntel.score],
                    ["summarize", snap.ship.specialistIntel.summarize],
                  ] as const
                ).map(([name, r]) => (
                  <li key={name}>
                    <span className="font-medium text-rd-ink">{name}</span>
                    {r.mocked ? " · MOCK" : " · live"} — {r.text.slice(0, 180)}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-rd-forest/65">
                Desk trustCheck: humanGateStillRequired=
                {String(snap.ship.deskIntel.trustCheck.humanGateStillRequired)} · keyEnv=
                {snap.ship.deskIntel.trustCheck.keyEnvVar}
              </p>
            </section>

            <section className="mt-16 grid gap-12 md:grid-cols-2">
              <div>
                <h2 className="font-display text-2xl text-rd-ink">Portfolio</h2>
                <ul className="mt-4 space-y-3 text-sm text-rd-forest/75">
                  {snap.portfolio.customers.map((c) => (
                    <li key={c.customerId}>
                      {c.customerName} · {c.application} · {c.customerId}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-rd-forest/55">
                  Token slice save ~{snap.portfolio.tokenBudget.savingsTokensEst} (
                  {snap.portfolio.tokenBudget.savingsPct}%) · Security satisfied=
                  {String(snap.portfolio.security.satisfied)}
                </p>
              </div>
              <div>
                <h2 className="font-display text-2xl text-rd-ink">NHI keys</h2>
                <p className="mt-2 text-sm text-rd-forest/70">
                  Exclusive RELEASEDESK_* only — values never shown.
                </p>
                <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-xs">
                  {snap.nhiCredentials.map((c) => (
                    <li key={`${c.agentId}:${c.envVar}`} className="flex justify-between gap-2">
                      <span className="font-mono text-rd-forest/55">{c.envVar}</span>
                      <span className={c.present ? "text-rd-canopy" : "text-rd-forest/40"}>
                        {c.present ? "present" : "missing"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="mt-16">
              <h2 className="font-display text-2xl text-rd-ink">Grok Bot roster</h2>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {snap.bots.definitions.map((b) => (
                  <li key={b.id}>
                    <p className="font-medium text-rd-ink">{b.name}</p>
                    <p className="mt-1 font-mono text-xs text-rd-forest/45">{b.definitionPath}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-rd-forest/55">
                Cursor CAs:{" "}
                {snap.bots.agents
                  .filter((a) => a.runtime === "cursor_cloud")
                  .map((a) => a.label)
                  .join(" · ")}
              </p>
            </section>

            <section className="mt-16">
              <h2 className="font-display text-2xl text-rd-ink">One demo path</h2>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-rd-forest/75">
                {snap.demoPath.map((line) => (
                  <li key={line}>
                    <code className="text-rd-ink">{line}</code>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-sm text-rd-forest/65">
                Slides (live-edit): <code className="text-rd-ink">docs/spacexai-two-slides.md</code> ·
                full narrative <code className="text-rd-ink">docs/spacexai-demo-slides.md</code>
              </p>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
