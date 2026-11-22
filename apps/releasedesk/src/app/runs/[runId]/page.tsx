import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalGates } from "@/components/ApprovalGates";
import { AuditTrail } from "@/components/AuditTrail";
import { CheckpointTrail } from "@/components/CheckpointTrail";
import { CloudHandoffs } from "@/components/CloudHandoffs";
import { DeskHeader } from "@/components/DeskHeader";
import { FeatureSignOffPanel } from "@/components/FeatureSignOffPanel";
import { GrokBotsPanel } from "@/components/GrokBotsPanel";
import { GrokReleaseIntelPanel } from "@/components/GrokReleaseIntelPanel";
import { IterationApprovalGate } from "@/components/IterationApprovalGate";
import { MockLabel } from "@/components/MockLabel";
import { PrPanel } from "@/components/PrPanel";
import { ReadinessBanner } from "@/components/ReadinessBanner";
import { SpecialistResults } from "@/components/SpecialistResults";
import { getRun } from "@/lib/desk";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ runId: string }> };

export default async function RunPage({ params }: Props) {
  const { runId } = await params;
  const data = await getRun(runId);
  if (!data) notFound();

  const { desk, view, iterationGate } = data;
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
            <GrokReleaseIntelPanel runId={view.runId} />
            <CloudHandoffs tasks={tasks} />
            <PrPanel
              pullRequests={view.pullRequests.pullRequests}
              prClientMode={desk.prClientMode}
            />
            <GrokBotsPanel />
          </div>
          <div className="space-y-16">
            {iterationGate ? (
              <IterationApprovalGate runId={view.runId} iterationGate={iterationGate} />
            ) : null}
            <FeatureSignOffPanel
              runId={view.runId}
              checklists={(view.featureSignOffs?.checklists ?? []).map((c) => ({
                id: c.id,
                kind: c.kind,
                status: c.status,
                feature: {
                  title: c.feature.title,
                  summary: c.feature.summary,
                  sourceAgent: String(c.feature.sourceAgent),
                  ...(c.feature.branch !== undefined ? { branch: c.feature.branch } : {}),
                  ...(c.feature.prUrl !== undefined ? { prUrl: c.feature.prUrl } : {}),
                },
                items: c.items.map((i) => ({
                  id: i.id,
                  label: i.label,
                  description: i.description,
                  signedOff: i.signedOff,
                  ...(i.signedOffBy !== undefined ? { signedOffBy: i.signedOffBy } : {}),
                  ...(i.notes !== undefined ? { notes: i.notes } : {}),
                })),
                ...(c.completedBy !== undefined ? { completedBy: c.completedBy } : {}),
              }))}
            />
            <ApprovalGates runId={view.runId} gates={view.approvals.gates} />
            <AuditTrail events={view.run.auditTrail} />
          </div>
        </div>
      </main>
    </div>
  );
}
