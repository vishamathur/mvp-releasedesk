import { ChallengeTrigger } from "@/components/ChallengeTrigger";
import { DeskHeader } from "@/components/DeskHeader";
import { GrokBotsPanel } from "@/components/GrokBotsPanel";
import { HandoffBoard } from "@/components/HandoffBoard";
import { RunList } from "@/components/RunList";
import { listRuns } from "@/lib/desk";

export const dynamic = "force-dynamic";

/**
 * Optimized Wednesday desk — brief spine only:
 * agent navigation · challenge trigger · recent runs.
 * Intake / demo gallery demoted (not deleted) off this surface.
 */
export default async function DeskPage() {
  const runs = await listRuns();

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
            Open Lead · CA · Standards · Security · Builder (persona / skills / routines). Trigger
            the workflow, then the red-team|security gate and Grok API intel. Full enterprise path:{" "}
            <a href="/control" className="text-rd-canopy underline-offset-4 hover:underline">
              /control
            </a>
            .
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
          <ChallengeTrigger />
          <section>
            <h2 className="font-display text-2xl text-rd-ink">Recent runs</h2>
            <p className="mt-2 text-sm text-rd-forest/65">
              Open a run for iteration gate (approve/reject) + Grok API panel + cloud handoffs.
            </p>
            <div className="mt-6">
              <RunList runs={runs} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
