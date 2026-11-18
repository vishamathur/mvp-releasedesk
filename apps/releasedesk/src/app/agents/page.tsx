"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";

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
  grokBotAppAgentId?: string | null;
  grokBotAppName?: string | null;
  host?: string;
  provisionStatus: string;
  provisionLabel?: string;
  created?: boolean;
};

type AgentDef = {
  id: string;
  label: string;
  runtime: string;
  mission: string;
  apiKeyEnv: string[];
  mandatoryOnEveryChange?: boolean;
  delegatesTo?: string[];
};

export default function AgentsPage() {
  const [bots, setBots] = useState<BotPack[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>("lead");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, c] = await Promise.all([fetch("/api/bots"), fetch("/api/sdlc-mvp")]);
        const botsBody = (await b.json()) as { bots?: BotPack[]; error?: string };
        const cat = (await c.json()) as { agents?: AgentDef[]; error?: string };
        if (!b.ok) throw new Error(botsBody.error ?? "bots failed");
        if (!c.ok) throw new Error(cat.error ?? "catalog failed");
        if (!cancelled) {
          setBots(botsBody.bots ?? []);
          setAgents(cat.agents ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cursor = agents.filter((a) => a.runtime === "cursor_cloud");
  const hybrid = agents.filter((a) => a.runtime === "hybrid");

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">Agents</p>
        <h1 className="mt-2 font-display text-4xl text-rd-ink">Full roster</h1>
        <p className="mt-3 max-w-2xl text-rd-forest/75">
          Grok Bots (Lead, Change Analyst, Standards, Security, Builder) plus Cursor Cloud Agents
          (Coding, Testing, Review). Personas, skills, routines, connectors — exclusive keys only.
        </p>
        <p className="mt-2">
          <Link href="/mvp" className="text-sm text-rd-canopy underline-offset-4 hover:underline">
            Back to SDLC control plane
          </Link>
        </p>

        {error ? (
          <p className="mt-6 text-sm text-[color:var(--rd-alert)]">{error}</p>
        ) : null}

        <section className="mt-12">
          <h2 className="font-display text-2xl text-rd-ink">Grok Bots</h2>
          <ul className="mt-6 space-y-8">
            {bots.map((bot) => (
              <li key={bot.id} className="border-t border-rd-mist/80 pt-5">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setOpenId(openId === bot.id ? null : bot.id)}
                >
                  <span className="font-medium text-rd-ink">{bot.displayName}</span>
                  <span className="ml-2 text-xs text-rd-forest/45">
                    {bot.keyPresent ? "key" : "no key"}
                    {" · "}
                    {bot.provisionLabel ?? bot.provisionStatus}
                  </span>
                </button>
                <p className="mt-2 text-sm text-rd-forest/70">
                  Skills: {bot.skills.map((s) => s.name).join(", ") || "—"}
                </p>
                {openId === bot.id ? (
                  <div className="mt-4 space-y-2 text-sm text-rd-forest/75">
                    <p>Routines: {bot.routines.map((r) => r.name).join(", ") || "—"}</p>
                    <p>Connectors: {bot.connectors.join(", ") || "—"}</p>
                    <p>Teammates: {bot.teammates.join(", ") || "—"}</p>
                    <p>Channels: {bot.channels.join(", ") || "—"}</p>
                    <p className="font-mono text-xs">{bot.definitionPath}</p>
                    <p className="font-mono text-xs">{bot.apiKeyEnv}</p>
                    {bot.grokBotAppAgentId ? (
                      <p className="font-mono text-xs">
                        Grok Bot app {bot.grokBotAppAgentId}
                        {bot.grokBotAppName ? ` · ${bot.grokBotAppName}` : ""} · not an xAI API id
                      </p>
                    ) : null}
                    {bot.liveBotId ? (
                      <p className="font-mono text-xs">xAI agent {bot.liveBotId}</p>
                    ) : null}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/60">
                      {bot.persona}
                    </pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl text-rd-ink">Hybrid (Lead / Builder)</h2>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2">
            {hybrid.map((a) => (
              <li key={a.id}>
                <p className="font-medium text-rd-ink">{a.label}</p>
                <p className="mt-2 text-sm text-rd-forest/70">{a.mission}</p>
                <p className="mt-2 font-mono text-xs text-rd-forest/45">{a.apiKeyEnv.join(", ")}</p>
                {a.delegatesTo ? (
                  <p className="mt-1 text-xs text-rd-forest/55">→ {a.delegatesTo.join(", ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl text-rd-ink">Cursor Cloud Agents</h2>
          <p className="mt-2 text-rd-forest/70">
            Coding, Testing, and Review — all required on the Builder path; none merge.
          </p>
          <ul className="mt-6 grid gap-6 sm:grid-cols-3">
            {cursor.map((a) => (
              <li key={a.id}>
                <p className="font-medium text-rd-ink">{a.label}</p>
                <p className="mt-2 text-sm text-rd-forest/70">{a.mission}</p>
                <p className="mt-2 font-mono text-xs text-rd-forest/45">{a.apiKeyEnv.join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
