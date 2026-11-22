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

export default function AgentsPage() {
  const [bots, setBots] = useState<BotPack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>("lead");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/bots");
        const botsBody = (await response.json()) as { bots?: BotPack[]; error?: string };
        if (!response.ok) throw new Error(botsBody.error ?? "bots failed");
        if (!cancelled) setBots(botsBody.bots ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">Agents</p>
        <h1 className="mt-2 font-display text-4xl text-rd-ink">Full roster</h1>
        <p className="mt-3 max-w-2xl text-rd-forest/75">
          Intake, Lead, Change Analyst, Standards, Security, and Builder. Personas, skills, routines,
          and connectors. Intake is the public front door and talks only to Lead. Release Desk Log
          records copies and does not route work.
        </p>
        <p className="mt-2 text-sm text-rd-forest/75">
          The handover trace is on{" "}
          <Link href="/handoff" className="text-rd-canopy underline-offset-4 hover:underline">
            /handoff
          </Link>
          .
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
      </main>
    </div>
  );
}
