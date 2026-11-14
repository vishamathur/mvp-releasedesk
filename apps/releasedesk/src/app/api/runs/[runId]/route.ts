import { NextResponse } from "next/server";
import { getRun } from "@/lib/desk";

export const runtime = "nodejs";

type Props = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { runId } = await params;
  const data = await getRun(runId);
  if (!data) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({
    runId: data.view.runId,
    list: data.list,
    readiness: data.view.leadOutput.readiness,
    summary: data.view.leadOutput.summary,
    blockingIssues: data.view.leadOutput.blockingIssues,
    approvals: data.view.approvals,
    checkpoints: data.view.checkpoints,
    pullRequests: data.view.pullRequests,
    assessment: data.view.assessment,
    tasks: data.view.run.tasks,
    auditTrail: data.view.run.auditTrail,
    dmSession: data.desk.dmSession,
    scenarioId: data.desk.scenarioId,
    scenarioLabel: data.desk.scenarioLabel,
    prClientMode: data.desk.prClientMode,
    autoMerge: false,
  });
}
