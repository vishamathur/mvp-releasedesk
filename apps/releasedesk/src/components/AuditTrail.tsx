type AuditEvent = {
  id: string;
  action: string;
  message: string;
  at: string;
  actor?: { kind?: string; agentRole?: string; name?: string };
};

export function AuditTrail({ events }: { events: AuditEvent[] }) {
  const latest = [...events].reverse();
  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Audit trail</h2>
      <p className="mt-2 text-sm text-rd-forest/70">
        Every Lead action, checkpoint, and human gate — newest first.
      </p>
      <ol className="mt-6 max-h-[28rem] space-y-3 overflow-y-auto pr-2">
        {latest.map((event) => (
          <li key={event.id} className="border-l-2 border-rd-brass/50 pl-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-rd-brass">
                {event.action}
              </p>
              <time className="text-[11px] text-rd-forest/45">{event.at}</time>
            </div>
            <p className="mt-1 text-sm text-rd-ink">{event.message}</p>
            <p className="mt-1 text-[11px] text-rd-forest/45">
              {event.actor?.kind ?? "system"}
              {event.actor?.agentRole ? ` · ${event.actor.agentRole}` : ""}
              {event.actor?.name ? ` · ${event.actor.name}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
