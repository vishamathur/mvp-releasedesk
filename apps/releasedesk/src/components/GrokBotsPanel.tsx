"use client";

import { useEffect, useMemo, useState } from "react";
import { MockLabel } from "./MockLabel";

type BotPack = {
  id: string;
  displayName: string;
  label: string;
  apiKeyEnv: string;
  keyPresent: boolean;
  liveBotId: string | null;
  grokBotAppAgentId?: string | null;
  grokBotAppName?: string | null;
  host?: string;
  provisionStatus: string;
  provisionLabel?: string;
  created?: boolean;
  definitionPath: string;
  persona: string;
  skills: Array<{ name: string; body: string }>;
  routines: Array<{ name: string; body: string }>;
  connectors: string[];
  teammates: string[];
  channels: string[];
  memoryNotes: string[];
};

const ORDER = ["lead", "change-analyst", "standards", "security", "builder"];

export function GrokBotsPanel({ deepDiveId = "security" }: { deepDiveId?: string }) {
  const [bots, setBots] = useState<BotPack[]>([]);
  const [openId, setOpenId] = useState<string>("lead");
  const [tab, setTab] = useState<"persona" | "skills" | "routines" | "connectors">("persona");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/bots");
        const json = (await res.json()) as { bots?: BotPack[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load bots");
        const list = [...(json.bots ?? [])].sort(
          (a, b) => (ORDER.indexOf(a.id) + 99) - (ORDER.indexOf(b.id) + 99),
        );
        setBots(list);
        setOpenId(list[0]?.id ?? "lead");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const current = useMemo(() => bots.find((b) => b.id === openId), [bots, openId]);
  const allCreatedInApp =
    bots.length > 0 &&
    bots.every((b) => b.created && b.host === "grok-bot-app" && b.grokBotAppAgentId);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-rd-ink">Grok Bots</h2>
          <p className="mt-2 max-w-2xl text-sm text-rd-forest/70">
            Lead · CA · Standards · Security · Builder — open persona, skills, routines, connectors.
            {allCreatedInApp
              ? " Created in the Grok Bot app. Those agent ids are not sent to the xAI API."
              : ""}
          </p>
        </div>
        {allCreatedInApp ? (
          <span className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
            Created in Grok Bot app
          </span>
        ) : (
          <MockLabel>defs · no fake live IDs</MockLabel>
        )}
      </div>

      {error ? <p className="mt-4 text-sm text-rd-alert">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {bots.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`btn-ghost !text-xs ${openId === b.id ? "!bg-rd-forest/10 font-bold" : ""}`}
            onClick={() => {
              setOpenId(b.id);
              setTab("persona");
            }}
          >
            {b.displayName || b.id}
            {b.id === deepDiveId ? " · deep" : ""}
          </button>
        ))}
      </div>

      {!current ? (
        <p className="mt-6 text-sm text-rd-forest/55">Loading…</p>
      ) : (
        <div className="mt-6 border-y border-rd-forest/10 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
            {current.displayName} · {current.provisionLabel ?? current.provisionStatus}
          </p>
          {current.grokBotAppAgentId ? (
            <p className="mt-1 font-mono text-xs normal-case text-rd-forest/55">
              Grok Bot app {current.grokBotAppAgentId}
              {current.grokBotAppName ? ` · ${current.grokBotAppName}` : ""}. Not an xAI API id.
            </p>
          ) : current.liveBotId ? (
            <p className="mt-1 font-mono text-xs normal-case text-rd-forest/55">
              xAI {current.liveBotId}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-rd-forest/55">
            {current.definitionPath} · no per-bot API key
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["persona", "skills", "routines", "connectors"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn-ghost !text-xs ${tab === t ? "!bg-rd-forest/10" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "persona" ? (
            <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-rd-forest/5 p-4 text-xs leading-relaxed text-rd-forest/80">
              {current.persona}
            </pre>
          ) : null}

          {tab === "skills" ? (
            <div className="mt-4 space-y-3">
              {current.skills.map((s) => (
                <div key={s.name} className="border-b border-rd-forest/10 pb-3">
                  <p className="text-sm font-medium text-rd-ink">{s.name}</p>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/75">
                    {s.body}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "routines" ? (
            <div className="mt-4 space-y-3">
              {current.routines.map((r) => (
                <div key={r.name}>
                  <p className="text-sm font-medium text-rd-ink">{r.name}</p>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/75">
                    {r.body}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "connectors" ? (
            <div className="mt-4 space-y-2 text-sm text-rd-forest/75">
              <ul className="list-disc pl-5">
                {current.connectors.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="font-medium text-rd-ink">Channels</p>
              <ul className="list-disc pl-5">
                {current.channels.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="font-medium text-rd-ink">Teammates</p>
              <ul className="list-disc pl-5">
                {current.teammates.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
