import { NextResponse } from "next/server";
import { listGrokBotPacks } from "@/lib/grok-bots-host";

export const runtime = "nodejs";

/** Openable catalog of SpaceXAI Grok Bot definitions (Lead + CA + Standards + Security + Builder). */
export async function GET() {
  const bots = await listGrokBotPacks();
  return NextResponse.json({
    ok: true,
    host: "grok-bots/definitions",
    count: bots.length,
    bots,
    createScript: "npm run create:grok-bots",
    envVars: [
      "RELEASEDESK_GROK_API_KEY_LEAD",
      "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST",
      "RELEASEDESK_GROK_API_KEY_STANDARDS",
      "RELEASEDESK_GROK_API_KEY_SECURITY",
      "RELEASEDESK_GROK_API_KEY_BUILDER",
    ],
  });
}
