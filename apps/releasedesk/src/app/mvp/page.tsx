"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";
import { MockLabel } from "@/components/MockLabel";
import type { SdlcMvpPortfolioReport } from "@/lib/sdlc-mvp";

type BotCard = {
  id: string;
  displayName: string;
  definitionPath: string;
  triad: boolean;
  persona: string;
  mission: string;
  skills: string[];
  routines: string[];
  connectors: string[];
  teammates: string[];
  channels: string[];
  grokApiKeyEnv: string;
  keyPresent: boolean;
  webhookConfigured: boolean;
  openLive: string;
  firstMessage: string;
};

type BotsResponse = {
  triadIds: string[];
  bots: BotCard[];
  shipPath: string;
  note?: string;
};

type GateView = {
  iterationId: string;
  title: string;
  gate: {
    canProceed: boolean;
    hasRedTeamApproval: boolean;
    hasSecurityApproval: boolean;
    blockingIssue?: string;
  };
};

type CatalogResponse = {
  agents: SdlcMvpPortfolioReport["agents"];
  credentials: SdlcMvpPortfolioReport["credentials"];
  portfolio: Array<{
    customerId: string;
    customerName: string;
    application: string;
    repository: string;
  }>;
  requirements: SdlcMvpPortfolioReport["requirements"];
};

type TriggerResult = {
  botId: string;
  mode: string;
  mocked: boolean;
  summary: string;
  openLive: string;
  definitionPath: string;
};

type IntelResult = {
  shipPath: string;
  keyEnv: string;
  classify: { mocked: boolean; text: string };
  extract: { mocked: boolean; text: string };
  score: { mocked: boolean; text: string };
  summarize: { mocked: boolean; text: string };
};

export default function MvpPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [bots, setBots] = useState<BotsResponse | null>(null);
  const [report, setReport] = useState<SdlcMvpPortfolioReport | null>(null);
  const [gate, setGate] = useState<GateView | null>(null);
  const [triggerLog, setTriggerLog] = useState<TriggerResult | null>(null);
  const [intel, setIntel] = useState<IntelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catRes, botsRes, gateRes] = await Promise.all([
          fetch("/api/sdlc-mvp"),
          fetch("/api/bots"),
          fetch("/api/iteration-gate"),
        ]);
        const cat = (await catRes.json()) as CatalogResponse & { error?: string };
        const botBody = (await botsRes.json()) as BotsResponse & { error?: string };
        const gateBody = (await gateRes.json()) as GateView & { error?: string };
        if (!catRes.ok) throw new Error(cat.error ?? "Catalog failed");
        if (!botsRes.ok) throw new Error(botBody.error ?? "Bots failed");
        if (!cancelled) {
          setCatalog(cat);
          setBots(botBody);
          if (gateRes.ok) setGate(gateBody);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load MVP");
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

  const triggerBot = useCallback((botId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/bots/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botId,
            payload: { source: "desk-mvp", customerId: "northwind" },
          }),
        });
        const body = (await res.json()) as TriggerResult & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Trigger failed");
        setTriggerLog(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Trigger failed");
      }
    });
  }, []);

  const signGate = useCallback((kind: "red_team" | "security") => {
    startTransition(async () => {
      const res = await fetch("/api/iteration-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, approvedBy: "desk-operator" }),
      });
      const body = (await res.json()) as GateView & { error?: string };
      if (res.ok) setGate(body);
      else setError(body.error ?? "Gate update failed");
    });
  }, []);

  const resetGate = useCallback(() => {
    startTransition(async () => {
      const res = await fetch("/api/iteration-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const body = (await res.json()) as GateView;
      if (res.ok) setGate(body);
    });
  }, []);

  const runIntel = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/grok/release-intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "all" }),
        });
        const body = (await res.json()) as IntelResult & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Intel failed");
        setIntel(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Intel failed");
      }
    });
  }, []);

  const requirements = report?.requirements ?? catalog?.requirements;
  const credentials = report?.credentials ?? catalog?.credentials ?? [];
  const agents = report?.agents ?? catalog?.agents ?? [];
  const grokBots = bots?.bots ?? [];
  const cursorAgents = agents.filter((a) => a.runtime === "cursor_cloud");
  const presentCount = credentials.filter((c) => c.present).length;

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
            Full agent surface: Grok Bots (Lead + Change Analyst + Standards + Security + Builder)
            and Cursor Cloud Agents (Coding + Testing + Review), plus one Grok API ship path.
            Agility, mandatory security, and token efficiency stay in view.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MockLabel>MOCK without exclusive keys</MockLabel>
            <Link href="/agents" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Agents detail
            </Link>
            <Link href="/desk" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Full desk
            </Link>
          </div>
        </div>

        <section className="animate-rise-delay mt-14">
          <h2 className="font-display text-2xl text-rd-ink">Three requirements</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            Agility · security · token efficiency — portfolio speed, mandatory Security, lean slices.
          </p>
          <ol className="mt-8 grid gap-10 md:grid-cols-3">
            {[
              {
                key: "01",
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
                key: "02",
                title: requirements?.security.label ?? "Security",
                body:
                  requirements?.security.summary ??
                  "Mandatory Security on every change — no selective skip.",
                meta: requirements
                  ? `mandatory · allOk=${String(requirements.security.allCustomersOk)}`
                  : "Mandatory participation",
              },
              {
                key: "03",
                title: requirements?.tokenEfficiency.label ?? "Token efficiency",
                body:
                  requirements?.tokenEfficiency.summary ??
                  "Role slices vs full-run packing.",
                meta: requirements
                  ? `~${requirements.tokenEfficiency.totalSavingsTokensEst} tokens · avg ${requirements.tokenEfficiency.averageSavingsPct}%`
                  : "Slice vs full run",
              },
            ].map((item) => (
              <li key={item.key}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-brass">
                  {item.key}
                </p>
                <h3 className="mt-3 font-display text-2xl text-rd-ink">{item.title}</h3>
                <p className="mt-2 text-rd-forest/75">{item.body}</p>
                <p className="mt-3 text-sm text-rd-forest/55">{item.meta}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <button
              type="button"
              className="btn-primary"
              onClick={runPortfolio}
              disabled={pending}
            >
              {pending && !triggerLog ? "Running…" : report ? "Re-run portfolio check" : "Run portfolio check"}
            </button>
          </div>
          {report ? (
            <p className="mt-4 text-sm text-rd-forest/65">
              Security {report.requirements.security.allCustomersOk ? "met" : "blocked"} · token savings ~
              {report.requirements.tokenEfficiency.totalSavingsTokensEst} ·{" "}
              {report.requirements.agility.customersChecked} customers
            </p>
          ) : null}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Grok Bots — open &amp; trigger</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            All five bots (not packs-only). Webhook if configured; else exclusive-key xAI chat; else MOCK.
            Highlight triad Lead · Security · Builder; Standards and Change Analyst remain first-class.
          </p>
          <ul className="mt-8 space-y-6">
            {grokBots.map((bot) => (
              <li key={bot.id} className="border-t border-rd-mist/80 pt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium text-rd-ink">
                      {bot.displayName}
                      {bot.triad ? (
                        <span className="ml-2 text-xs uppercase tracking-[0.14em] text-rd-brass">
                          triad
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-rd-forest/65">{bot.mission}</p>
                    <p className="mt-1 font-mono text-xs text-rd-forest/45">{bot.definitionPath}</p>
                  </div>
                  <span
                    className={`text-xs font-bold uppercase tracking-[0.14em] ${
                      bot.keyPresent ? "text-rd-canopy" : "text-rd-forest/45"
                    }`}
                  >
                    {bot.keyPresent ? "key present" : "key missing"}
                    {bot.webhookConfigured ? " · webhook" : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm text-rd-forest/55">
                  skills: {bot.skills.join(", ") || "—"} · routines: {bot.routines.join(", ") || "—"}
                </p>
                <p className="mt-1 text-sm text-rd-forest/55">
                  connectors: {bot.connectors.join(", ")} · teammates: {bot.teammates.join(", ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setOpenId(openId === bot.id ? null : bot.id)}
                  >
                    {openId === bot.id ? "Hide open-live" : "Open live"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={pending}
                    onClick={() => triggerBot(bot.id)}
                  >
                    Trigger
                  </button>
                </div>
                {openId === bot.id ? (
                  <div className="mt-3 space-y-2 text-sm text-rd-forest/75">
                    <p>{bot.openLive}</p>
                    <p className="font-mono text-xs text-rd-forest/55">{bot.grokApiKeyEnv}</p>
                    <p className="whitespace-pre-wrap text-xs text-rd-forest/65">{bot.firstMessage}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {triggerLog ? (
            <div className="mt-6 border-t border-rd-mist/80 pt-4 text-sm text-rd-forest/75">
              <p className="font-medium text-rd-ink">
                Last trigger · {triggerLog.botId} · {triggerLog.mode}
                {triggerLog.mocked ? " · MOCK" : " · live"}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{triggerLog.summary.slice(0, 800)}</p>
            </div>
          ) : null}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Cursor Cloud Agents</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            Coding · Testing · Review — exclusive <code className="text-rd-ink">RELEASEDESK_CURSOR_API_KEY_*</code>,
            never shared <code className="text-rd-ink">CURSOR_API_KEY</code>. Builder hands off; no auto-merge.
          </p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-3">
            {cursorAgents.map((agent) => (
              <li key={agent.id}>
                <p className="font-medium text-rd-ink">{agent.label}</p>
                <p className="mt-2 text-sm text-rd-forest/70">{agent.mission}</p>
                <p className="mt-2 font-mono text-xs text-rd-forest/45">
                  {agent.apiKeyEnv.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Iteration gate</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            PR #14 hard gate: <strong className="font-medium text-rd-ink">red_team | security</strong> before
            proceed. Human merge/release remain separate.
          </p>
          <p className="mt-4 text-sm text-rd-forest/75">
            {gate
              ? gate.gate.canProceed
                ? "Open — approval satisfied"
                : gate.gate.blockingIssue ?? "Pending approval"
              : "Loading…"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={() => signGate("security")}>
              Sign security
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => signGate("red_team")}>
              Sign red_team
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={resetGate}>
              Reset
            </button>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Grok API ship</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            One shipped module:{" "}
            <code className="text-rd-ink">
              {bots?.shipPath ?? "packages/releasedesk-specialists/src/grok-api-intel.ts"}
            </code>{" "}
            — classify / extract / score / summarize via{" "}
            <code className="text-rd-ink">RELEASEDESK_GROK_API_KEY_BUILDER</code>.
          </p>
          <button type="button" className="btn-primary mt-4" disabled={pending} onClick={runIntel}>
            Run release intel
          </button>
          {intel ? (
            <ul className="mt-6 space-y-3 text-sm text-rd-forest/75">
              {(
                [
                  ["classify", intel.classify],
                  ["extract", intel.extract],
                  ["score", intel.score],
                  ["summarize", intel.summarize],
                ] as const
              ).map(([name, r]) => (
                <li key={name}>
                  <span className="font-medium text-rd-ink">{name}</span>
                  {r.mocked ? " · MOCK" : " · live"} — {r.text.slice(0, 200)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Per-agent API keys</h2>
          <p className="mt-2 text-rd-forest/70">
            Exclusive env vars only — {presentCount}/{credentials.length} present. Values never shown.
          </p>
          <ul className="mt-6 divide-y divide-rd-mist/80 border-y border-rd-mist/80">
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
        </section>

        {error ? (
          <p className="mt-10 text-sm text-[color:var(--rd-alert)]" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
