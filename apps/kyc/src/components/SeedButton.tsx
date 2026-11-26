"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSeed() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seed", { method: "POST", credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed");
      setMessage(`Loaded ${data.count} sample applications.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary" onClick={onSeed} disabled={busy}>
        {busy ? "Seeding…" : "Load sample data"}
      </button>
      {message ? <p className="text-sm text-[color:var(--nw-steel)]">{message}</p> : null}
    </div>
  );
}
