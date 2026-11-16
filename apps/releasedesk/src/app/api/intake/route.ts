import { NextResponse } from "next/server";
import { enqueueIntakeRequest, getIntakeList } from "@/lib/intake";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId") ?? undefined;
    const list = await getIntakeList(customerId);
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load intake" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      customerId?: string;
      customerName?: string;
      customerWeight?: number;
      title?: string;
      summary?: string;
      requestedBy?: string;
      amount?: number;
      currency?: string;
      direction?: "charge" | "spend" | "credit";
    };
    if (!body.customerName || !body.title || !body.summary || body.amount == null) {
      return NextResponse.json(
        { error: "customerName, title, summary, and amount are required" },
        { status: 400 },
      );
    }
    const result = await enqueueIntakeRequest({
      ...(body.customerId ? { customerId: body.customerId } : {}),
      customerName: body.customerName,
      ...(body.customerWeight !== undefined
        ? { customerWeight: body.customerWeight }
        : {}),
      title: body.title,
      summary: body.summary,
      ...(body.requestedBy ? { requestedBy: body.requestedBy } : {}),
      amount: body.amount,
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.direction ? { direction: body.direction } : {}),
    });
    return NextResponse.json({
      itemId: result.item.id,
      requestId: result.request.id,
      costEstimateId: result.cost.id,
      customerId: result.customer.customerId,
      status: result.item.status,
      cost: result.cost,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to enqueue" },
      { status: 500 },
    );
  }
}
