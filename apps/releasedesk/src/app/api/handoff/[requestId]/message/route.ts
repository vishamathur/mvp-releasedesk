import { NextResponse } from "next/server";
import { getHandoffEngine } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  if (!body || !("message" in body)) {
    return NextResponse.json(
      { ok: false, code: "invalid_schema", errors: ["message is required"] },
      { status: 400 },
    );
  }
  const result = getHandoffEngine().submitMessage(body.message);
  if (!result.ok && result.code === "unknown_request") {
    return NextResponse.json({ ...result, requestId }, { status: 400 });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
