import { NextResponse } from "next/server";
import { getHandoffEngine } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  const request = getHandoffEngine().getRequest(requestId);
  if (!request) {
    return NextResponse.json(
      { ok: false, code: "unknown_request", errors: [`No request ${requestId}`] },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, request });
}
