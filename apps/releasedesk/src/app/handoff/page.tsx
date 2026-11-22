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
          PID-ER and PID-NC move by teammate message. Only Lead writes pid.state. Stage returns come
          back to Lead. A bot never sets a human gate to approved. The customer intake site and the
          leaderboard are not part of this desk.
        </p>
        <div className="mt-12">
          <HandoffBoard />
        </div>
      </main>
    </div>
  );
}
