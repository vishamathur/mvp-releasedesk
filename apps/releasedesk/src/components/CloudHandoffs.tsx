import { MockLabel } from "./MockLabel";

type Task = {
  id: string;
  name: string;
  agentRole: string;
  status: string;
  output?: Record<string, unknown> | null;
};

const ROLE_BOUNDARIES: Record<string, string> = {
  coding: "Ships repo code (Grok release-intel path)",
  testing: "Verifies independently — never merges",
  review: "Reviews independently — never merges",
};

export function CloudHandoffs({ tasks }: { tasks: Task[] }) {
  const builders = tasks.filter((t) => t.agentRole === "builder");
  const anyMock =
    builders.length === 0 ||
    builders.some((t) => {
      const mode = t.output?.cloudClientMode;
      if (mode === "real") return false;
      if (mode === "mock" || mode === "skipped") return true;
      const summary = typeof t.output?.summary === "string" ? t.output.summary : "";
      return summary.startsWith("MOCK:") || mode == null;
    });

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Cloud agent handoffs</h2>
        {anyMock ? (
          <MockLabel>MOCK Cursor Cloud</MockLabel>
        ) : (
          <span className="rounded-sm bg-rd-brass/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-rd-brass">
            LIVE Cursor Cloud
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Builder → <strong>Coding</strong> (ships) → <strong>Testing</strong> ∥ <strong>Review</strong>{" "}
        (verify/review). Exclusive keys{" "}
        <span className="font-mono text-[11px]">RELEASEDESK_CURSOR_API_KEY_*</span>. Never auto-merge.
      </p>
      {builders.length === 0 ? (
        <p className="mt-6 text-sm text-rd-forest/55">
          No Builder handoffs in this run (clean analysis wave).
        </p>
      ) : (
        <ul className="mt-6 space-y-6">
          {builders.map((task) => {
            const workItems = Array.isArray(task.output?.workItems)
              ? (task.output!.workItems as Array<Record<string, unknown>>)
              : [];
            const clientMode =
              typeof task.output?.cloudClientMode === "string"
                ? task.output.cloudClientMode
                : "unknown";
            return (
              <li key={task.id} className="border-t border-rd-forest/10 pt-4">
                <p className="font-medium text-rd-ink">{task.name}</p>
                <p className="mt-1 text-sm text-rd-forest/65">
                  {typeof task.output?.summary === "string"
                    ? task.output.summary
                    : `Status: ${task.status}`}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-rd-brass">
                  client={clientMode} · autoMerge=false
                </p>
                {workItems.length > 0 ? (
                  <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                    {workItems.map((item, i) => {
                      const kind = String(item.kind ?? "agent");
                      return (
                        <li key={`${task.id}-${i}`}>
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-brass">
                            {kind}
                          </p>
                          <p className="mt-1 text-sm text-rd-ink">{String(item.status ?? "—")}</p>
                          <p className="mt-1 text-xs text-rd-forest/55">
                            {ROLE_BOUNDARIES[kind] ?? "Cursor cloud agent"}
                          </p>
                          {typeof item.branch === "string" ? (
                            <p className="mt-1 font-mono text-[11px] text-rd-forest/50">
                              {item.branch}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
