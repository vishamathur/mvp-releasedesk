import { NextResponse } from "next/server";
import { listHandoffLogs } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const replay = new URL(request.url).searchParams.get("replay") === "1";
  return NextResponse.json(listHandoffLogs({ replay }));
}
