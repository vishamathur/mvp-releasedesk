import { NextResponse } from "next/server";
import { reorderIntake } from "@/lib/intake";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orderedItemIds?: string[];
      signedOffBy?: string;
      notes?: string;
    };
    if (!body.orderedItemIds?.length) {
      return NextResponse.json({ error: "orderedItemIds required" }, { status: 400 });
    }
    if (!body.signedOffBy) {
      return NextResponse.json(
        { error: "signedOffBy required — re-prioritize sign-off is mandatory" },
        { status: 400 },
      );
    }
    const result = await reorderIntake({
      orderedItemIds: body.orderedItemIds,
      signedOffBy: body.signedOffBy,
      ...(body.notes ? { notes: body.notes } : {}),
    });
    return NextResponse.json({ signOff: result.signOff });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reorder failed" },
      { status: 500 },
    );
  }
}
