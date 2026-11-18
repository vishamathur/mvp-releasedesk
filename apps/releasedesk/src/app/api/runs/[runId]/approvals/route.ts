import { NextResponse } from "next/server";
import { applyGateDecision } from "@/lib/desk";

export const runtime = "nodejs";

type Props = { params: Promise<{ runId: string }> };

export async function POST(request: Request, { params }: Props) {
  const { runId } = await params;
  try {
    const body = (await request.json()) as {
      gateId?: string;
      decision?: "approved" | "rejected";
      decidedBy?: string;
      notes?: string;
    };
    if (!body.gateId || (body.decision !== "approved" && body.decision !== "rejected")) {
      return NextResponse.json(
        { error: "gateId and decision (approved|rejected) are required" },
        { status: 400 },
      );
    }
    const result = await applyGateDecision({
      runId,
      gateId: body.gateId,
      decision: body.decision,
      ...(body.decidedBy !== undefined ? { decidedBy: body.decidedBy } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    return NextResponse.json({
      runId: result.view.runId,
      readiness: result.view.leadOutput.readiness,
      approvals: result.view.approvals,
      blockingIssues: result.view.leadOutput.blockingIssues,
      list: result.list,
      autoMerge: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approval failed" },
      { status: 400 },
    );
  }
}
