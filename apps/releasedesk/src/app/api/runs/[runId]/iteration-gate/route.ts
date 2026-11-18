import { NextResponse } from "next/server";
import { applyIterationGateDecision } from "@/lib/desk";

export const runtime = "nodejs";

type Props = { params: Promise<{ runId: string }> };

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
