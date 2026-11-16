import { NextResponse } from "next/server";
import { applyIterationGateDecision, getRun } from "@/lib/desk";

export const runtime = "nodejs";

type Props = { params: Promise<{ runId: string }> };

/** GET — current run-scoped iteration gate (red_team|security) when present. */
export async function GET(_request: Request, { params }: Props) {
  const { runId } = await params;
  const data = await getRun(runId);
  if (!data) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (!data.iterationGate) {
    return NextResponse.json(
      { error: `Run ${runId} has no iteration gate demo state`, runId },
      { status: 404 },
    );
  }
  return NextResponse.json({
    runId,
    iterationGate: data.iterationGate,
    readiness: data.view.leadOutput.readiness,
    blockingIssues: data.view.leadOutput.blockingIssues,
  });
}

export async function POST(request: Request, { params }: Props) {
  const { runId } = await params;
  try {
    const body = (await request.json()) as {
      decision?: "approved" | "rejected";
      kind?: "red_team" | "security";
      decidedBy?: string;
      note?: string;
    };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json(
        { error: "decision (approved|rejected) is required" },
        { status: 400 },
      );
    }
    if (body.decision === "approved" && body.kind !== "red_team" && body.kind !== "security") {
      return NextResponse.json(
        { error: "kind (red_team|security) is required when approving" },
        { status: 400 },
      );
    }
    const result = await applyIterationGateDecision({
      runId,
      decision: body.decision,
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.decidedBy !== undefined ? { decidedBy: body.decidedBy } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
    return NextResponse.json({
      runId: result.view.runId,
      readiness: result.view.leadOutput.readiness,
      blockingIssues: result.view.leadOutput.blockingIssues,
      iterationGate: result.iterationGate,
      list: result.list,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Iteration gate decision failed" },
      { status: 400 },
    );
  }
}
