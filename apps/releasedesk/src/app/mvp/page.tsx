"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";
import { MockLabel } from "@/components/MockLabel";
import type { SdlcMvpPortfolioReport } from "@/lib/sdlc-mvp";

type BotPack = {
  id: string;
  displayName: string;
  definitionPath: string;
  persona: string;
  skills: Array<{ name: string }>;
  routines: Array<{ name: string }>;
  connectors: string[];
  teammates: string[];
  channels: string[];
  apiKeyEnv: string;
  keyPresent: boolean;
  liveBotId: string | null;
  provisionStatus: string;
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
  runId: string;
  runUrl: string;
  readiness: string;
  handoffs: string[];
    intel?: {
      mode: string;
      mocked: boolean;
      classify: { category: string; confidence: number };
      extract?: string[];
      score?: { level: string; rationale: string };
      summarize: string;
    };
};

type IntelResult = {
  mode: string;
  mocked: boolean;
  classify: { category: string; confidence: number };
  extract: string[];
  score: { level: string; rationale: string };
  summarize: string;
  trustCheck: {
    humanGateStillRequired: true;
    noAutoApprove: true;
    keyEnvVar: string;
    notes: string[];
  };
};

const TRIAD = new Set(["lead", "security", "builder"]);

export default function MvpPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [bots, setBots] = useState<BotPack[]>([]);
  const [report, setReport] = useState<SdlcMvpPortfolioReport | null>(null);
  const [gate, setGate] = useState<GateView | null>(null);
  const [triggerLog, setTriggerLog] = useState<TriggerResult | null>(null);
  const [intel, setIntel] = useState<IntelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>("security");

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
        const botBody = (await botsRes.json()) as { bots?: BotPack[]; error?: string };
        const gateBody = (await gateRes.json()) as GateView & { error?: string };
        if (!catRes.ok) throw new Error(cat.error ?? "Catalog failed");
        if (!botsRes.ok) throw new Error(botBody.error ?? "Bots failed");
        if (!cancelled) {
          setCatalog(cat);
          setBots(botBody.bots ?? []);
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

  const triggerChallenge = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/bots/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: "SpaceXAI showcase: multi-customer SDLC release readiness",
            repository: "vishamathur/mvp-releasedesk",
          }),
        });
        const body = (await res.json()) as TriggerResult & { error?: string; ok?: boolean };
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
          body: JSON.stringify({
            repository: "vishamathur/mvp-releasedesk",
            goal: "Showcase release intel",
            findings: [
              { source: "security", text: "TLS cipher suite gap on KYC upload", severity: "high" },
              { source: "standards", text: "Retention label missing on export", severity: "medium" },
            ],
          }),
        });
        const body = (await res.json()) as { intel?: IntelResult; error?: string };
        if (!res.ok || !body.intel) throw new Error(body.error ?? "Intel failed");
        setIntel(body.intel);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Intel failed");
      }
    });
  }, []);

  const requirements = report?.requirements ?? catalog?.requirements;
  const credentials = report?.credentials ?? catalog?.credentials ?? [];
  const agents = report?.agents ?? catalog?.agents ?? [];
  const cursorAgents = agents.filter((a) => a.runtime === "cursor_cloud");
  const presentCount = credentials.filter((c) => c.present).length;

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
            SDLC control plane
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
            Release Desk
          </h1>
          <p className="mt-3 max-w-2xl text-rd-forest/75">
            Grok Bots (Lead + Change Analyst + Standards + Security + Builder) → Cursor Coding
            ships code that calls Grok API → humans own iteration gate, merge, and release.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <MockLabel>MOCK without exclusive keys</MockLabel>
            <Link href="/agents" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Agents panel
            </Link>
            <Link href="/desk" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
              Challenge desk
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
          <div className="mt-8 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={runPortfolio}
              disabled={pending}
            >
              {pending && !triggerLog ? "Running…" : report ? "Re-run portfolio check" : "Run portfolio check"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={triggerChallenge}
              disabled={pending}
            >
              Challenge trigger
            </button>
          </div>
          {report ? (
            <p className="mt-4 text-sm text-rd-forest/65">
              Security {report.requirements.security.allCustomersOk ? "met" : "blocked"} · token savings ~
              {report.requirements.tokenEfficiency.totalSavingsTokensEst} ·{" "}
              {report.requirements.agility.customersChecked} customers
            </p>
          ) : null}
          {triggerLog ? (
            <div className="mt-4 text-sm text-rd-forest/75">
              <p className="font-medium text-rd-ink">
                Challenge →{" "}
                <Link href={triggerLog.runUrl} className="underline-offset-4 hover:underline">
                  {triggerLog.runId}
                </Link>{" "}
                · readiness {triggerLog.readiness}
                {triggerLog.intel?.mocked ? " · MOCK intel" : triggerLog.intel ? " · live intel" : ""}
              </p>
              <ul className="mt-2 list-disc pl-5">
                {triggerLog.handoffs.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Grok Bots — open &amp; navigate</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            Full roster with persona, skills, routines, connectors. Live bot IDs only appear after{" "}
            <code className="text-rd-ink">npm run create:grok-bots</code> with exclusive keys.
          </p>
          <ul className="mt-8 space-y-6">
            {bots.map((bot) => (
              <li key={bot.id} className="border-t border-rd-mist/80 pt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-medium text-rd-ink">
                      {bot.displayName}
                      {TRIAD.has(bot.id) ? (
                        <span className="ml-2 text-xs uppercase tracking-[0.14em] text-rd-brass">
                          triad
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 font-mono text-xs text-rd-forest/45">{bot.definitionPath}</p>
                  </div>
                  <span
                    className={`text-xs font-bold uppercase tracking-[0.14em] ${
                      bot.keyPresent ? "text-rd-canopy" : "text-rd-forest/45"
                    }`}
                  >
                    {bot.keyPresent ? "key present" : "key missing"}
                    {bot.liveBotId ? " · live id" : ` · ${bot.provisionStatus}`}
                  </span>
                </div>
                <p className="mt-2 text-sm text-rd-forest/55">
                  skills: {bot.skills.map((s) => s.name).join(", ") || "—"} · routines:{" "}
                  {bot.routines.map((r) => r.name).join(", ") || "—"}
                </p>
                <p className="mt-1 text-sm text-rd-forest/55">
                  connectors: {bot.connectors.join(", ") || "—"} · teammates:{" "}
                  {bot.teammates.join(", ") || "—"}
                </p>
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  onClick={() => setOpenId(openId === bot.id ? null : bot.id)}
                >
                  {openId === bot.id ? "Hide persona" : "Open persona"}
                </button>
                {openId === bot.id ? (
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/70">
                    {bot.persona}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl text-rd-ink">Cursor Cloud Agents</h2>
          <p className="mt-2 max-w-2xl text-rd-forest/70">
            Coding ships · Testing verifies · Review reviews — exclusive{" "}
            <code className="text-rd-ink">RELEASEDESK_CURSOR_API_KEY_*</code>; never merge.
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
            Hard gate: <span className="font-medium text-rd-ink">red_team | security</span> before
            proceed. Human merge/release remain separate and never auto-approved.
          </p>
          <p className="mt-4 text-sm text-rd-forest/75">
            {gate
              ? gate.gate.canProceed
                ? "Open — approval satisfied"
                : (gate.gate.blockingIssue ?? "Pending approval")
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
            Shipped module{" "}
            <code className="text-rd-ink">apps/releasedesk/src/lib/grok-release-intel.ts</code> —
            classify / extract / score / summarize via{" "}
            <code className="text-rd-ink">RELEASEDESK_GROK_API_KEY_LEAD</code>. Trust check keeps
            human gates authoritative.
          </p>
          <button type="button" className="btn-primary mt-4" disabled={pending} onClick={runIntel}>
            Run release intel
          </button>
          {intel ? (
            <div className="mt-6 space-y-3 text-sm text-rd-forest/75">
              <p className="font-medium text-rd-ink">
                {intel.classify.category} · conf {intel.classify.confidence} ·{" "}
                {intel.mocked ? "MOCK" : "live"} · score {intel.score.level}
              </p>
              <p>{intel.summarize}</p>
              <p>Extract: {intel.extract.join("; ") || "—"}</p>
              <p>Score rationale: {intel.score.rationale}</p>
              <ul className="list-disc pl-5">
                {intel.trustCheck.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
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
