import Link from "next/link";
import { DemoStoreNotice } from "@/components/DemoStoreNotice";
import { LogoutButton } from "@/components/LogoutButton";
import type { KycRole } from "@/lib/auth";

export function AppShell({
  children,
  title,
  subtitle,
  role,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  role?: KycRole;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[color:var(--nw-sand)] bg-[color:var(--nw-navy)] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl">Northwind</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
              Bank · KYC
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            {role === "analyst" ? (
              <Link href="/applications" className="text-white/75 hover:text-white">
                Applications
              </Link>
            ) : null}
            {role === "customer" ? (
              <Link href="/applications/new" className="text-[color:var(--nw-accent)] hover:text-white">
                New application
              </Link>
            ) : null}
            {role ? (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">
                  {role}
                </span>
                <LogoutButton />
              </>
            ) : (
              <Link href="/login" className="text-white/75 hover:text-white">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <DemoStoreNotice />
        <div className="animate-rise mb-8">
          <h1 className="font-display text-4xl text-[color:var(--nw-ink)]">{title}</h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-[color:var(--nw-steel)]">{subtitle}</p>
          ) : null}
        </div>
        <div className="animate-rise-delay">{children}</div>
      </main>
    </div>
  );
}
