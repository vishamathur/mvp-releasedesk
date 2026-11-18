import { NextResponse } from "next/server";
import { listRuns } from "@/lib/desk";

export const runtime = "nodejs";

export async function GET() {
  const runs = await listRuns();
  return NextResponse.json({ runs });
}
