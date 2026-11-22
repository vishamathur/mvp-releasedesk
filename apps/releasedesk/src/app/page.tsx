import Link from "next/link";
import { DeskHeader } from "@/components/DeskHeader";
import { MockLabel } from "@/components/MockLabel";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <section className="relative min-h-[100svh] overflow-hidden hero-plane text-white">
        <DeskHeader tone="dark" />
        <div className="absolute inset-0">
          <div className="animate-drift absolute -left-10 top-28 h-80 w-80 rounded-full bg-[color:var(--rd-brass)]/15 blur-3xl" />
          <div className="animate-drift absolute bottom-10 right-0 h-72 w-72 rounded-full bg-[color:var(--rd-canopy)]/30 blur-3xl" />
          <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[color:var(--rd-ink)]/60 to-transparent" />
        </div>
        <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-6 pb-20 pt-24">
          <p className="animate-rise font-display text-5xl leading-none tracking-tight sm:text-7xl md:text-8xl">
            Release Desk
          </p>
          <h1 className="animate-rise-delay mt-6 max-w-xl text-2xl font-medium text-white/88 sm:text-3xl">
            Enterprise SDLC control plane for multi-customer IT services.
          </h1>
          <p className="animate-rise-delay mt-4 max-w-lg text-base text-white/65">
            Grok Bots → Cursor Coding → Grok API intel, with mandatory Security/ATLAS, iteration
            gate, and human merge/release. Northwind KYC is the worked example.
          </p>
          <div className="animate-rise-late mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/mvp"
              className="btn-primary !bg-[color:var(--rd-brass)] !text-[color:var(--rd-ink)]"
            >
              Open control plane
            </Link>
            <Link
              href="/desk"
              className="btn-secondary !border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
            >
              Challenge desk
            </Link>
            <Link
              href="/handoff"
              className="btn-secondary !border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
            >
              SDLC handover
            </Link>
            <span className="inline-flex items-center gap-2 text-sm text-white/55">
              <MockLabel>MOCK integrations labeled</MockLabel>
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl text-rd-ink">What the desk shows</h2>
        <p className="mt-3 max-w-2xl text-rd-forest/75">
          One job per surface — driven by real orchestrator run context, not scripted agent chat.
        </p>
        <ol className="mt-12 grid gap-12 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Check",
              body: "Launch Lead on-demand release checks wired to specialist runners and checkpoints.",
            },
            {
              step: "02",
              title: "Evidence",
              body: "Inspect run ID, specialist results, cloud handoffs, PR metadata, and the audit trail.",
            },
            {
              step: "03",
              title: "Decide",
              body: "Approve or reject merge and release gates. Auto-merge is never performed.",
            },
          ].map((item) => (
            <li key={item.step}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-brass">
                {item.step}
              </p>
              <h3 className="mt-3 font-display text-2xl text-rd-ink">{item.title}</h3>
              <p className="mt-2 text-rd-forest/75">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
