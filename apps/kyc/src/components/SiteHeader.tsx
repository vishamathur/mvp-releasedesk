import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="group flex items-baseline gap-2 text-white">
          <span className="font-display text-2xl tracking-tight transition group-hover:text-[color:var(--nw-accent)]">
            Northwind
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
            Bank
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm text-white/85">
          <Link href="/applications" className="btn-ghost text-white/80 hover:text-white">
            Applications
          </Link>
          <Link href="/applications/new" className="btn-primary !bg-white !text-[color:var(--nw-ink)] hover:!bg-[color:var(--nw-sand)]">
            Start KYC
          </Link>
        </nav>
      </div>
    </header>
  );
}
