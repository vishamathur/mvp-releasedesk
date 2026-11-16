import { NextResponse } from "next/server";
import { AgentRoleSchema, triggerGrokBot } from "@releasedesk/core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      botId?: string;
      routineId?: string;
      payload?: Record<string, unknown>;
      prompt?: string;
    };
    const parsed = AgentRoleSchema.safeParse(body.botId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "botId must be lead|change_analyst|standards|security|builder" },
        { status: 400 },
      );
    }
    const result = await triggerGrokBot({
      botId: parsed.data,
      ...(body.routineId !== undefined ? { routineId: body.routineId } : {}),
      ...(body.payload !== undefined ? { payload: body.payload } : {}),
      ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Trigger failed" },
      { status: 500 },
    );
  }
}
