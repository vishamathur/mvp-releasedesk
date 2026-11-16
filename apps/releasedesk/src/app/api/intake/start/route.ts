import { NextResponse } from "next/server";
import { startFromIntakeItem } from "@/lib/intake";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { itemId?: string };
    if (!body.itemId) {
      return NextResponse.json({ error: "itemId required" }, { status: 400 });
    }
    const result = await startFromIntakeItem(body.itemId);
    return NextResponse.json({
      runId: result.runId,
      readiness: result.report.leadOutput.readiness,
      itemStatus: result.queue.items.find((i) => i.id === body.itemId)?.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Start from intake failed" },
      { status: 500 },
    );
  }
}
