"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";
import { MockLabel } from "@/components/MockLabel";
import type { SdlcMvpPortfolioReport } from "@/lib/sdlc-mvp";

type CatalogPortfolioItem = {
  customerId: string;
  customerName: string;
  application: string;
  repository: string;
};

type CatalogResponse = {
  agents: SdlcMvpPortfolioReport["agents"];
  credentials: SdlcMvpPortfolioReport["credentials"];
  portfolio: CatalogPortfolioItem[];
  requirements: SdlcMvpPortfolioReport["requirements"];
  mockNote?: string;
};

export default function MvpPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [report, setReport] = useState<SdlcMvpPortfolioReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sdlc-mvp");
        const body = (await res.json()) as CatalogResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load catalog");
        if (!cancelled) setCatalog(body);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load catalog");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runPortfolio = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sdlc-mvp", { method: "POST" });
        const body = (await res.json()) as SdlcMvpPortfolioReport & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Portfolio check failed");
        setReport(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Portfolio check failed");
      }
    });
  }, []);

  const requirements = report?.requirements ?? catalog?.requirements;
  const credentials = report?.credentials ?? catalog?.credentials ?? [];
  const agents = report?.agents ?? catalog?.agents ?? [];
  const presentCount = credentials.filter((c) => c.present).length;
  const missingCount = credentials.length - presentCount;

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
            SDLC optimization MVP
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
            Release Desk
          </h1>
          <p className="mt-3 max-w-2xl text-rd-forest/75">
            Delivery-manager view of agility, mandatory security, and token efficiency across the
            multi-customer ITS portfolio (Northwind KYC proof app).
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MockLabel>MOCK specialists</MockLabel>
            <MockLabel>MOCK GitHub PR</MockLabel>
            <Link href="/desk" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Open full desk
            </Link>
          </div>
        </div>

        <section className="animate-rise-delay mt-14">
          <h2 className="font-display text-2xl text-rd-ink">Three requirements</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            One job each — portfolio speed, early security participation, lean prompts for margin.
          </p>
          <ol className="mt-8 grid gap-10 md:grid-cols-3">
            {[
              {
                key: "agility",
                title: requirements?.agility.label ?? "Agility",
                body:
                  requirements?.agility.summary ??
                  "On-demand release checks across many client apps.",
                meta: requirements
                  ? `${requirements.agility.customersChecked} customers · tagged=${String(
                      requirements.agility.allTaggedWithCustomerId,
                    )}`
                  : "Portfolio on-demand checks",
              },
              {
                key: "security",
                title: requirements?.security.label ?? "Security",
                body:
                  requirements?.security.summary ??
                  "Mandatory Security on every change — no selective skip.",
                meta: requirements
                  ? `mandatory · allOk=${String(requirements.security.allCustomersOk)}`
                  : "Mandatory participation",
              },
              {
                key: "token",
                title: requirements?.tokenEfficiency.label ?? "Token efficiency",
                body:
                  requirements?.tokenEfficiency.summary ??
                  "Role slices vs full-run packing.",
                meta: requirements
                  ? `~${requirements.tokenEfficiency.totalSavingsTokensEst} tokens saved · avg ${requirements.tokenEfficiency.averageSavingsPct}%`
                  : "Slice vs full run",
              },
            ].map((item) => (
              <li key={item.key}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-brass">
                  {item.key === "token" ? "03" : item.key === "security" ? "02" : "01"}
                </p>
                <h3 className="mt-3 font-display text-2xl text-rd-ink">{item.title}</h3>
                <p className="mt-2 text-rd-forest/75">{item.body}</p>
                <p className="mt-3 text-sm text-rd-forest/55">{item.meta}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="animate-rise-late mt-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl text-rd-ink">Portfolio results</h2>
              <p className="mt-2 max-w-xl text-rd-forest/70">
                Lead stubs run one on-demand check per DEMO_PORTFOLIO customer with{" "}
                <code className="text-rd-ink">metadata.customerId</code>.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={runPortfolio}
              disabled={pending}
            >
              {pending ? "Running portfolio…" : report ? "Re-run portfolio check" : "Run portfolio check"}
            </button>
          </div>

          {error ? (
            <p className="mt-6 text-sm text-[color:var(--rd-alert)]" role="alert">
              {error}
            </p>
          ) : null}

          {!report && catalog?.portfolio ? (
            <ul className="mt-8 space-y-4">
              {catalog.portfolio.map((c) => (
                <li key={c.customerId} className="border-t border-rd-mist/80 pt-4">
                  <p className="font-medium text-rd-ink">
                    {c.customerName} · {c.application}
                  </p>
                  <p className="mt-1 text-sm text-rd-forest/60">
                    {c.customerId} · {c.repository}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {report ? (
            <div className="mt-8 space-y-8">
              <div className="grid gap-6 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-forest/50">
                    Security mandatory
                  </p>
                  <p className="mt-2 font-display text-3xl text-rd-ink">
                    {report.requirements.security.allCustomersOk ? "Met" : "Blocked"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-forest/50">
                    Token savings vs full run
                  </p>
                  <p className="mt-2 font-display text-3xl text-rd-ink">
                    ~{report.requirements.tokenEfficiency.totalSavingsTokensEst}
                  </p>
                  <p className="mt-1 text-sm text-rd-forest/55">
                    avg {report.requirements.tokenEfficiency.averageSavingsPct}% (security slice)
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-forest/50">
                    Customers checked
                  </p>
                  <p className="mt-2 font-display text-3xl text-rd-ink">
                    {report.requirements.agility.customersChecked}
                  </p>
                </div>
              </div>

              <ul className="space-y-6">
                {report.customers.map((c) => (
                  <li key={c.runId} className="border-t border-rd-mist/80 pt-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-rd-ink">
                        {c.customerName} · {c.application}
                      </p>
                      <span className="text-sm text-rd-forest/60">{c.readiness}</span>
                    </div>
                    <p className="mt-1 text-sm text-rd-forest/55">
                      {c.customerId} · run {c.runId}
                    </p>
                    <p className="mt-3 text-sm text-rd-forest/75">
                      Security:{" "}
                      {c.security.ok
                        ? "completed with recorded result"
                        : c.security.blockingIssues.join("; ")}
                    </p>
                    <p className="mt-1 text-sm text-rd-forest/75">
                      Token slice: {c.tokenBudget.sliceTokensEst} vs full{" "}
                      {c.tokenBudget.fullRunTokensEst} (−{c.tokenBudget.savingsTokensEst} /{" "}
                      {c.tokenBudget.savingsPct}%)
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <MockLabel>MOCK specialists</MockLabel>
                      <MockLabel>MOCK PR</MockLabel>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-rd-forest/55">{report.mockNote}</p>
            </div>
          ) : null}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Per-agent API keys</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            Exclusive env vars only — presence shown, values never displayed.{" "}
            <span className="text-rd-forest/55">
              {presentCount} present · {missingCount} missing
            </span>
          </p>
          <ul className="mt-8 divide-y divide-rd-mist/80 border-y border-rd-mist/80">
            {credentials.map((cred) => (
              <li
                key={`${cred.agentId}:${cred.envVar}`}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-rd-ink">{cred.agentId}</p>
                  <p className="font-mono text-xs text-rd-forest/55">{cred.envVar}</p>
                </div>
                <span
                  className={`text-xs font-bold uppercase tracking-[0.14em] ${
                    cred.present ? "text-rd-canopy" : "text-rd-forest/45"
                  }`}
                >
                  {cred.present ? "present" : "missing"}
                </span>
              </li>
            ))}
          </ul>

          {agents.length > 0 ? (
            <div className="mt-10">
              <h3 className="font-display text-xl text-rd-ink">Working agents</h3>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {agents.map((agent) => (
                  <li key={agent.id}>
                    <p className="font-medium text-rd-ink">{agent.label}</p>
                    <p className="mt-1 text-sm text-rd-forest/65">{agent.mission}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-rd-forest/45">
                      {agent.runtime}
                      {agent.mandatoryOnEveryChange ? " · mandatory" : ""}
                      {agent.usesContextSlice ? " · context slice" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
