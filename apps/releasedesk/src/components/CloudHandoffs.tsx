import { MockLabel } from "./MockLabel";

type Task = {
  id: string;
  name: string;
  agentRole: string;
  status: string;
  output?: Record<string, unknown> | null;
};

export function CloudHandoffs({ tasks }: { tasks: Task[] }) {
  const builders = tasks.filter((t) => t.agentRole === "builder");

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Cloud agent handoffs</h2>
        <MockLabel>MOCK Cursor Cloud</MockLabel>
      </div>
      <p className="mt-2 text-sm text-rd-forest/70">
        Builder work items for Coding / Testing / Review when remediation runs.
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
            return (
              <li key={task.id} className="border-t border-rd-forest/10 pt-4">
                <p className="font-medium text-rd-ink">{task.name}</p>
                <p className="mt-1 text-sm text-rd-forest/65">
                  {typeof task.output?.summary === "string"
                    ? task.output.summary
                    : `Status: ${task.status}`}
                </p>
                {workItems.length > 0 ? (
                  <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                    {workItems.map((item, i) => (
                      <li key={`${task.id}-${i}`}>
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-brass">
                          {String(item.kind ?? "agent")}
                        </p>
                        <p className="mt-1 text-sm text-rd-ink">{String(item.status ?? "—")}</p>
                        {typeof item.branch === "string" ? (
                          <p className="mt-1 font-mono text-[11px] text-rd-forest/50">
                            {item.branch}
                          </p>
                        ) : null}
                      </li>
                    ))}
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
