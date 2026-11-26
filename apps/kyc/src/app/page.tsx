import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <section className="relative min-h-[100svh] overflow-hidden hero-wash text-white">
        <SiteHeader />
        <div className="absolute inset-0">
          <div className="animate-drift absolute -right-16 top-24 h-72 w-72 rounded-full bg-[color:var(--nw-teal-bright)]/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[color:var(--nw-navy)]/50 to-transparent" />
        </div>
        <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-6 pb-20 pt-28">
          <p className="animate-rise font-display text-5xl leading-none tracking-tight sm:text-7xl md:text-8xl">
            Northwind Bank
          </p>
          <h1 className="animate-rise-delay mt-6 max-w-xl text-2xl font-medium text-white/90 sm:text-3xl">
            Know Your Customer onboarding for new retail accounts.
          </h1>
          <p className="animate-rise-delay mt-4 max-w-lg text-base text-white/70">
            Capture identity, attach supporting documents, and track risk status in a
            realistic ITeS demo used by Release Desk.
          </p>
          <div className="animate-rise-delay mt-10 flex flex-wrap gap-3">
            <Link
              href="/login?next=/applications/new"
              className="btn-primary !bg-[color:var(--nw-accent)] !text-[color:var(--nw-navy)] hover:!brightness-110"
            >
              Start customer KYC
            </Link>
            <Link href="/login?next=/applications" className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20">
              Analyst queue
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl text-[color:var(--nw-ink)]">How onboarding works</h2>
        <p className="mt-3 max-w-2xl text-[color:var(--nw-steel)]">
          A three-step happy path for demo reviews and later release-check agents.
        </p>
        <ol className="mt-10 grid gap-10 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Identity",
              body: "Collect legal name, date of birth, contact details, residential address, and an optional occupation.",
            },
            {
              step: "02",
              title: "Documents",
              body: "Attach government ID and proof of address placeholders. OCR and IDV APIs are mocked.",
            },
            {
              step: "03",
              title: "Risk & status",
              body: "Submit for local risk scoring, then move through review, approval, or needs-info.",
            },
          ].map((item) => (
            <li key={item.step}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--nw-teal)]">
                {item.step}
              </p>
              <h3 className="mt-3 font-display text-2xl text-[color:var(--nw-ink)]">{item.title}</h3>
              <p className="mt-2 text-[color:var(--nw-steel)]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
