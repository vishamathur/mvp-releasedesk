import { NextResponse } from "next/server";
import { getHandoffEngine, isHumanGateId } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    gate?: string;
    decision?: string;
    decidedBy?: string;
    note?: string;
    continue?: boolean;
  } | null;
  if (!body?.gate || !isHumanGateId(body.gate)) {
    return NextResponse.json(
      { ok: false, code: "wrong_gate", errors: ["gate is not a human gate on the PID specs"] },
      { status: 400 },
    );
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { ok: false, code: "invalid_schema", errors: ["decision must be approved or rejected"] },
      { status: 400 },
    );
  }
  const engine = getHandoffEngine();
  const decided = engine.recordHumanDecision({
    requestId,
    gate: body.gate,
    decision: body.decision,
    decidedBy: body.decidedBy ?? "",
    ...(body.note ? { note: body.note } : {}),
  });
  if (!decided.ok) return NextResponse.json(decided, { status: 400 });
  if (body.continue === false || decided.request.state.status !== "open") {
    return NextResponse.json(decided);
  }
  const ran = engine.runUntilWait(requestId);
  return NextResponse.json(ran, { status: ran.ok ? 200 : 400 });
}
