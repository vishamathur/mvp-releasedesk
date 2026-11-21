import { NextResponse } from "next/server";
import { listGrokBotPacks } from "@/lib/grok-bots-host";

export const runtime = "nodejs";

/** Openable catalog of SpaceXAI Grok Bot definitions (Lead + CA + Standards + Security + Builder). */
export async function GET() {
  const bots = await listGrokBotPacks();
  const createdInApp = bots.filter(
    (b) => b.created && b.host === "grok-bot-app" && b.grokBotAppAgentId,
  );
  return NextResponse.json({
    ok: true,
    host: "grok-bots/definitions",
    count: bots.length,
    createdCount: createdInApp.length,
    bots,
    createScript: "npm run create:grok-bots",
    note:
      "grokBotAppAgentId values are Grok Bot app teammate ids. Desk does not orchestrate handoffs and does not call api.x.ai with these ids. Bots do not take API keys. Shipped Grok calls read XAI_API_KEY.",
    envVars: ["XAI_API_KEY"],
  });
}
