import { NextResponse } from "next/server";
import { listGrokBotPacks } from "@/lib/grok-bots-host";

export const runtime = "nodejs";

/** Openable live catalog of Grok Bot packs (personas/skills/routines/connectors). */
export async function GET() {
  const bots = await listGrokBotPacks();
  return NextResponse.json({
    ok: true,
    host: "grok-bots",
    count: bots.length,
    bots,
    importGuide: "Paste PERSONA.md + skills/routines into https://x.ai/bot — see grok-bots/README.md",
  });
}
