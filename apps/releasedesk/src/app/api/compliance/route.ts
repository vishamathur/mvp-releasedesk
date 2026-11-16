import { NextResponse } from "next/server";
import { buildSpaceXaiComplianceSnapshot } from "@/lib/spacexai-compliance";

export const runtime = "nodejs";

/** GET — SpaceXAI NHI slot inventory + LIVE/MOCK chips (never secret values). */
export async function GET() {
  return NextResponse.json(buildSpaceXaiComplianceSnapshot());
}
