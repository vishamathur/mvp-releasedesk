import Link from "next/link";

export function DeskHeader({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="group flex items-baseline gap-3">
        <span
          className={`font-display text-2xl tracking-tight ${dark ? "text-white" : "text-rd-ink"}`}
        >
          Release Desk
        </span>
        <span
          className={`hidden text-xs font-medium uppercase tracking-[0.16em] sm:inline ${
            dark ? "text-white/55" : "text-rd-forest/60"
          }`}
        >
          Northwind Bank
        </span>
      </Link>
      <nav className="flex items-center gap-2">
        <Link
          href="/control"
          className={
            dark
              ? "text-sm font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
              : "text-sm font-medium text-rd-forest/70 underline-offset-4 hover:text-rd-ink hover:underline"
          }
        >
          Control plane
        </Link>
        <Link
          href="/desk"
          className={
            dark
              ? "btn-secondary !border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
              : "btn-secondary"
          }
        >
          Open desk
        </Link>
      </nav>
    </header>
  );
}
