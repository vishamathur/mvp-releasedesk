"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn-ghost text-white/80 hover:text-white" onClick={onLogout} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
