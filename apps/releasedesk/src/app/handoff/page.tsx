import { DeskHeader } from "@/components/DeskHeader";
import { HandoffBoard } from "@/components/HandoffBoard";

export const dynamic = "force-dynamic";

export default function HandoffPage() {
  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rd-forest/50">
          SDLC handover · handoff.v1
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight text-rd-ink sm:text-5xl">
          Bot to bot
        </h1>
        <p className="mt-3 max-w-2xl text-rd-forest/75">
          Bots run the process; Release Desk Log records it; Desk shows it. PID-ER and PID-NC v1.1.0
          move by teammate message in Lead&apos;s chat. The stage owner raises each human gate.
        </p>
        <div className="mt-12">
          <HandoffBoard />
        </div>
      </main>
    </div>
  );
}
