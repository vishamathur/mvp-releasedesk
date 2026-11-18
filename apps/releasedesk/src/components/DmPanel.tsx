"use client";

import { useState } from "react";
import { MockLabel } from "./MockLabel";

type Msg = {
  channel: string;
  role: string;
  text: string;
  at: string;
  mock?: boolean;
};

export function DmPanel({
  runId,
  initialMessages = [],
}: {
  runId?: string;
  initialMessages?: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(channel: "text" | "voice") {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, channel, runId }),
      });
      const body = (await res.json()) as { dmSession?: { messages: Msg[] }; error?: string };
      if (!res.ok || !body.dmSession) throw new Error(body.error ?? "DM failed");
      setMessages(body.dmSession.messages);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DM failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Lead interface</h2>
        <MockLabel>Voice MOCK</MockLabel>
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Text is primary. Voice is a labeled stub — it does not fabricate agent transcripts.
      </p>
      <div className="mt-4 max-h-56 space-y-3 overflow-y-auto rounded-md border border-rd-forest/10 bg-white/40 p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-rd-forest/50">No messages yet.</p>
        ) : (
          messages.map((m, i) => (
            <div key={`${m.at}-${i}`}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-rd-brass">
                {m.role} · {m.channel}
                {m.mock ? " · MOCK" : ""}
              </p>
              <p className="text-sm text-rd-ink">{m.text}</p>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-md border border-rd-forest/20 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-rd-canopy focus:ring-2 focus:ring-rd-canopy/20"
          placeholder="Message the Lead…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void send("text")}
        >
          Send text
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void send("voice")}
        >
          MOCK voice
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-rd-alert">{error}</p> : null}
    </section>
  );
}
