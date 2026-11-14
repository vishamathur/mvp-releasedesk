type Specialist = {
  role: string;
  taskId: string;
  status: string;
  summary?: string;
  name?: string;
};

export function SpecialistResults({
  specialists,
  tasks,
}: {
  specialists: Specialist[];
  tasks: Array<{ id: string; name: string; agentRole: string; status: string }>;
}) {
  return (
    <section>
      <h2 className="font-display text-2xl text-rd-ink">Specialist results</h2>
      <p className="mt-2 max-w-2xl text-sm text-rd-forest/70">
        Independently recorded task outputs from the Lead orchestrator — not scripted chat.
      </p>
      <ul className="mt-6 divide-y divide-rd-forest/10 border-y border-rd-forest/10">
        {tasks
          .filter((t) => t.agentRole !== "lead")
          .map((task) => {
            const snap = specialists.find((s) => s.taskId === task.id);
            return (
              <li key={task.id} className="grid gap-2 py-4 sm:grid-cols-[9rem_1fr_auto]">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-rd-brass">
                  {task.agentRole.replace(/_/g, " ")}
                </p>
                <div>
                  <p className="font-medium text-rd-ink">{task.name}</p>
                  <p className="mt-1 text-sm text-rd-forest/70">
                    {snap?.summary ?? "No summary recorded"}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-rd-forest/40">{task.id}</p>
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-rd-forest/60">
                  {task.status}
                </p>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
