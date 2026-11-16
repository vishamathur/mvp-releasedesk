import { NextResponse } from "next/server";
import { buildControlPlaneSnapshot } from "@/lib/control-plane";

export const runtime = "nodejs";

/** GET — enterprise SDLC control-plane snapshot (one demo path). */
export async function GET() {
  try {
    const snapshot = await buildControlPlaneSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Control plane failed" },
      { status: 500 },
    );
  }
}
