import { DeskHeader } from "@/components/DeskHeader";
import { GrokBotsPanel } from "@/components/GrokBotsPanel";
import { HandoffBoard } from "@/components/HandoffBoard";

export const dynamic = "force-dynamic";

export default function DeskPage() {
  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
            Wednesday showcase · navigate agents first
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
            Release Desk
          </h1>
          <p className="mt-3 max-w-2xl text-rd-forest/75">
            Open Lead, Change Analyst, Standards, Security, and Builder. The iteration gate is
            Security's security-compliance-approval, asked in Security's chat.
          </p>
        </div>

        <div className="mt-14 animate-rise-delay space-y-16">
          <section>
            <h2 className="font-display text-2xl text-rd-ink">SDLC handover</h2>
            <p className="mt-2 max-w-2xl text-sm text-rd-forest/75">
              Bots run the process; Release Desk Log records it; Desk shows it.
            </p>
            <div className="mt-6">
              <HandoffBoard />
            </div>
          </section>
          <GrokBotsPanel deepDiveId="security" />
        </div>
      </main>
    </div>
  );
}
