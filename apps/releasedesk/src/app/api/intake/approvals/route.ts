import { NextResponse } from "next/server";
import { decideCostApproval, decideQueueApproval } from "@/lib/intake";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: "queue" | "cost";
      itemId?: string;
      costEstimateId?: string;
      decision?: "approved" | "rejected";
      decidedBy?: string;
      notes?: string;
    };

    if (!body.decision || (body.decision !== "approved" && body.decision !== "rejected")) {
      return NextResponse.json({ error: "decision required" }, { status: 400 });
    }

    if (body.kind === "cost") {
      if (!body.costEstimateId) {
        return NextResponse.json({ error: "costEstimateId required" }, { status: 400 });
      }
      const result = await decideCostApproval({
        costEstimateId: body.costEstimateId,
        decision: body.decision,
        ...(body.decidedBy ? { decidedBy: body.decidedBy } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      });
      return NextResponse.json({
        kind: "cost",
        cost: result.cost,
        item: result.item,
      });
    }

    if (!body.itemId) {
      return NextResponse.json({ error: "itemId required for queue approval" }, { status: 400 });
    }
    const result = await decideQueueApproval({
      itemId: body.itemId,
      decision: body.decision,
      ...(body.decidedBy ? { decidedBy: body.decidedBy } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    return NextResponse.json({ kind: "queue", item: result.item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approval failed" },
      { status: 500 },
    );
  }
}
