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
      "grokBotAppAgentId values are Grok Bot app teammate ids (host grok-bot-app), not xAI Agents API ids. Desk does not call api.x.ai with them. Exclusive RELEASEDESK_GROK_API_KEY_* keys authenticate application chat-completions calls and are unset here when missing.",
    envVars: [
      "RELEASEDESK_GROK_API_KEY_LEAD",
      "RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST",
      "RELEASEDESK_GROK_API_KEY_STANDARDS",
      "RELEASEDESK_GROK_API_KEY_SECURITY",
      "RELEASEDESK_GROK_API_KEY_BUILDER",
    ],
  });
}
