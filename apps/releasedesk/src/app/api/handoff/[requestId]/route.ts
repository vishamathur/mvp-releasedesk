import { NextResponse } from "next/server";
import { traceHandoffLog } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { requestId } = await context.params;
  const result = traceHandoffLog(requestId);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
