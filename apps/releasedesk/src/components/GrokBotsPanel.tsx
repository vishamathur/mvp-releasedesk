"use client";

import { useEffect, useMemo, useState } from "react";
import { MockLabel } from "./MockLabel";

type BotPack = {
  id: string;
  persona: string;
  skills: Array<{ name: string; body: string }>;
  routines: Array<{ name: string; body: string }>;
  connectors: string[];
  teammates: string[];
  memoryNotes: string[];
};

const ORDER = ["lead", "change-analyst", "standards", "security", "builder"];

export function GrokBotsPanel({ deepDiveId = "security" }: { deepDiveId?: string }) {
  const [bots, setBots] = useState<BotPack[]>([]);
  const [openId, setOpenId] = useState<string>("lead");
  const [tab, setTab] = useState<"persona" | "skills" | "routines" | "connectors">("persona");
  const [skillOpen, setSkillOpen] = useState<string | null>(null);
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
  const idx = bots.findIndex((b) => b.id === openId);

  function go(delta: number) {
    if (bots.length === 0) return;
    const next = bots[(idx + delta + bots.length) % bots.length];
    if (!next) return;
    setOpenId(next.id);
    setTab("persona");
    setSkillOpen(null);
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-rd-ink">Grok Bot agents</h2>
          <p className="mt-2 max-w-2xl text-sm text-rd-forest/70">
            Look · pull up · move agent to agent · go deep. Primary Wednesday demo surface.
          </p>
        </div>
        <MockLabel>Packs from grok-bots/</MockLabel>
      </div>

      {error ? <p className="mt-4 text-sm text-rd-alert">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost !text-xs" onClick={() => go(-1)}>
          ← Prev agent
        </button>
        {bots.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`btn-ghost !text-xs ${openId === b.id ? "!bg-rd-forest/10 font-bold" : ""}`}
            onClick={() => {
              setOpenId(b.id);
              setTab("persona");
              setSkillOpen(null);
            }}
          >
            {b.id}
            {b.id === deepDiveId ? " · deep" : ""}
          </button>
        ))}
        <button type="button" className="btn-ghost !text-xs" onClick={() => go(1)}>
          Next agent →
        </button>
      </div>

      {!current ? (
        <p className="mt-6 text-sm text-rd-forest/55">Loading bot packs…</p>
      ) : (
        <div className="mt-6 border-y border-rd-forest/10 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rd-brass">
            Now viewing · {current.id}
            {current.id === deepDiveId ? " · recommended deep-dive" : ""}
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
              {current.skills.length === 0 ? (
                <p className="text-sm text-rd-forest/55">No skills file yet.</p>
              ) : (
                current.skills.map((s) => (
                  <div key={s.name} className="border-b border-rd-forest/10 pb-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-rd-ink underline-offset-2 hover:underline"
                      onClick={() => setSkillOpen(skillOpen === s.name ? null : s.name)}
                    >
                      {s.name}
                    </button>
                    {skillOpen === s.name || current.id === deepDiveId ? (
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/75">
                        {s.body}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "routines" ? (
            <div className="mt-4 space-y-3">
              {current.routines.length === 0 ? (
                <p className="text-sm text-rd-forest/55">No routines file yet.</p>
              ) : (
                current.routines.map((r) => (
                  <div key={r.name}>
                    <p className="text-sm font-medium text-rd-ink">{r.name}</p>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-rd-forest/75">
                      {r.body}
                    </pre>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "connectors" ? (
            <div className="mt-4 space-y-2 text-sm text-rd-forest/75">
              <p>
                <span className="font-medium text-rd-ink">Connectors:</span>{" "}
                {current.connectors.join(", ") || "n/a"}
              </p>
              <p>
                <span className="font-medium text-rd-ink">Teammates / channels:</span>
              </p>
              <ul className="list-disc pl-5">
                {current.teammates.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p>
                <span className="font-medium text-rd-ink">Memory:</span>{" "}
                {current.memoryNotes.join("; ")}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
