"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ nextHref }: { nextHref: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign-in failed");
      const destination =
        data.role === "analyst" && nextHref === "/" ? "/applications" : nextHref === "/" && data.role === "customer" ? "/applications/new" : nextHref;
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="token">
          Access token
        </label>
        <input
          id="token"
          className="field"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          minLength={16}
        />
        <p className="mt-1 text-xs text-[color:var(--nw-steel)]">
          Paste the customer token to start an application, or the analyst token to review the queue.
          The token is stored in an HttpOnly cookie and is not written to the page.
        </p>
      </div>
      {error ? <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
