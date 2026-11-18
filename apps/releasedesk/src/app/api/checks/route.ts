import { NextResponse } from "next/server";
import { startOnDemandCheck } from "@/lib/desk";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      repository?: string;
      requestedBy?: string;
    };
    const result = await startOnDemandCheck(body);
    return NextResponse.json({
      runId: result.view.runId,
      readiness: result.view.leadOutput.readiness,
      list: result.list,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start check" },
      { status: 500 },
    );
  }
}
