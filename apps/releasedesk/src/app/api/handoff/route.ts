import { NextResponse } from "next/server";
import { listHandoffLogs } from "@/lib/handoff-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  return NextResponse.json(listHandoffLogs());
}
