export function MockBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[color:var(--nw-accent)]/50 bg-[color:var(--nw-accent)]/10 px-4 py-3 text-sm text-[color:var(--nw-ink)]">
      <p className="font-semibold uppercase tracking-[0.08em] text-[color:var(--nw-steel)] text-[11px]">
        Mocked integration
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
