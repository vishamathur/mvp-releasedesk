import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalGates } from "@/components/ApprovalGates";
import { AuditTrail } from "@/components/AuditTrail";
import { CheckpointTrail } from "@/components/CheckpointTrail";
import { CloudHandoffs } from "@/components/CloudHandoffs";
import { DeskHeader } from "@/components/DeskHeader";
import { DmPanel } from "@/components/DmPanel";
import { MockLabel } from "@/components/MockLabel";
import { ObservabilityPanel } from "@/components/ObservabilityPanel";
import { PrPanel } from "@/components/PrPanel";
import { ReadinessBanner } from "@/components/ReadinessBanner";
import { ReleaseNotesPanel } from "@/components/ReleaseNotesPanel";
import { RollbackPanel } from "@/components/RollbackPanel";
import { SpecialistResults } from "@/components/SpecialistResults";
import { TestGatePanel } from "@/components/TestGatePanel";
import { getRun } from "@/lib/desk";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ runId: string }> };

export default async function RunPage({ params }: Props) {
  const { runId } = await params;
  const data = await getRun(runId);
  if (!data) notFound();

  const { desk, view } = data;
  const tasks = view.run.tasks.map((t) => ({
    id: t.id,
    name: t.name,
    agentRole: t.agentRole,
    status: t.status,
    output: (t.output ?? null) as Record<string, unknown> | null,
  }));

  return (
    <div className="min-h-screen">
      <DeskHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <div className="mb-8 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/desk" className="btn-ghost !px-0">
            ← Back to desk
          </Link>
          {desk.scenarioLabel ? (
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-rd-brass">
              Scenario · {desk.scenarioLabel}
            </span>
          ) : null}
          {desk.prClientMode === "mock" ? <MockLabel>MOCK GitHub PR client</MockLabel> : null}
        </div>

        <ReadinessBanner
          readiness={view.leadOutput.readiness}
          summary={view.leadOutput.summary}
          blockingIssues={view.leadOutput.blockingIssues}
          runId={view.runId}
        />

        <div className="mt-14 grid gap-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-16">
            <SpecialistResults specialists={view.assessment.specialists} tasks={tasks} />
            <CheckpointTrail checkpoints={view.checkpoints.checkpoints} />
            <TestGatePanel gates={view.testGates?.gates ?? []} />
            <ReleaseNotesPanel packages={view.releaseNotes?.packages ?? []} />
            <CloudHandoffs tasks={tasks} />
            <PrPanel
              pullRequests={view.pullRequests.pullRequests}
              prClientMode={desk.prClientMode}
            />
            <RollbackPanel plans={view.rollback?.plans ?? []} />
          </div>
          <div className="space-y-16">
            <ApprovalGates runId={view.runId} gates={view.approvals.gates} />
            <ObservabilityPanel
              summary={view.observability?.summary}
              events={view.observability?.events ?? []}
            />
            <AuditTrail events={view.run.auditTrail} />
            <DmPanel runId={view.runId} initialMessages={desk.dmSession.messages} />
          </div>
        </div>
      </main>
    </div>
  );
}
