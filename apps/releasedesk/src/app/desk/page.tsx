import { DeskHeader } from "@/components/DeskHeader";
import { DemoScenarios } from "@/components/DemoScenarios";
import { DmPanel } from "@/components/DmPanel";
import { IntakePanel } from "@/components/IntakePanel";
import { RunList } from "@/components/RunList";
import { StartCheckForm } from "@/components/StartCheckForm";
import { listDemoScenarios, listRuns } from "@/lib/desk";
import { getIntakeList } from "@/lib/intake";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const runs = await listRuns();
  const scenarios = listDemoScenarios();
  const intake = await getIntakeList();

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="animate-rise">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
            Delivery manager
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
            Release Desk
          </h1>
          <p className="mt-3 max-w-2xl text-rd-forest/75">
            Customer intake with dual cost + queue approvals, then Lead release readiness —
            review evidence and decide merge/release gates.
          </p>
        </div>

        <div className="mt-14 animate-rise-delay">
          <IntakePanel initialItems={intake.items} customers={intake.customers} />
        </div>

        <div className="mt-16 grid gap-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="animate-rise-delay space-y-16">
            <StartCheckForm />
            <DemoScenarios scenarios={scenarios} />
          </div>
          <div className="animate-rise-late space-y-16">
            <section>
              <h2 className="font-display text-2xl text-rd-ink">Recent runs</h2>
              <div className="mt-6">
                <RunList runs={runs} />
              </div>
            </section>
            <DmPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
