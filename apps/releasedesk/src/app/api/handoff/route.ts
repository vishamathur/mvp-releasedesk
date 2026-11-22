import { NextResponse } from "next/server";
import { getHandoffEngine, handoffCatalog, isProcessId } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(handoffCatalog());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    pid?: string;
    customerLabel?: string;
    summary?: string;
  } | null;
  if (!body?.pid || !isProcessId(body.pid)) {
    return NextResponse.json(
      { ok: false, code: "invalid_schema", errors: ["pid must be PID-ER or PID-NC"] },
      { status: 400 },
    );
  }
  const engine = getHandoffEngine();
  const opened = engine.openRequest({
    pid: body.pid,
    customerLabel: body.customerLabel ?? "",
    summary: body.summary ?? "",
  });
  if (!opened.ok) {
    return NextResponse.json(opened, { status: 400 });
  }
  const ran = engine.runUntilWait(opened.request.state.requestId);
  return NextResponse.json(ran, { status: ran.ok ? 201 : 400 });
}
