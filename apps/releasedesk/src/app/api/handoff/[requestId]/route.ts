import { NextResponse } from "next/server";
import { traceHandoffLog } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { requestId } = await context.params;
  const replay = new URL(request.url).searchParams.get("replay") === "1";
  const result = traceHandoffLog(requestId, { replay });
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
