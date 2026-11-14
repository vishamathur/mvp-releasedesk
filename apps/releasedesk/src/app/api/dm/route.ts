import { NextResponse } from "next/server";
import { postDmMessage } from "@/lib/desk";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      channel?: "text" | "voice";
      runId?: string;
    };
    if (!body.text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    const channel = body.channel === "voice" ? "voice" : "text";
    const result = await postDmMessage({
      text: body.text,
      channel,
      ...(body.runId !== undefined ? { runId: body.runId } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "DM failed" },
      { status: 400 },
    );
  }
}
