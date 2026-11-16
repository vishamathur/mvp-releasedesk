import { NextResponse } from "next/server";
import {
  GROK_BOT_DEFINITIONS,
  GROK_BOT_TRIAD_IDS,
  describeAgentGrokCredential,
  describeOpenLive,
  resolveBotWebhook,
} from "@releasedesk/core";

export const runtime = "nodejs";

/** GET — Grok Bot triad (+ full roster) with open-live instructions; never secret values. */
export async function GET() {
  const env = process.env;
  const triad = new Set<string>(GROK_BOT_TRIAD_IDS);
  const bots = GROK_BOT_DEFINITIONS.map((def) => {
    const cred = describeAgentGrokCredential(def.id, env);
    const { url, routine } = resolveBotWebhook(def, env);
    return {
      id: def.id,
      displayName: def.displayName,
      definitionPath: def.definitionPath,
      triad: triad.has(def.id),
      persona: def.persona,
      mission: def.mission,
      skills: def.skills.map((s) => s.name),
      routines: def.routines.map((r) => r.id),
      connectors: def.connectors,
      teammates: def.teammates,
      channels: def.channels,
      grokApiKeyEnv: def.grokApiKeyEnv,
      keyPresent: cred.present,
      webhookConfigured: Boolean(url),
      primaryRoutineId: routine?.id,
      openLive: describeOpenLive(def),
      firstMessage: def.firstMessage,
    };
  });

  return NextResponse.json({
    triadIds: [...GROK_BOT_TRIAD_IDS],
    bots,
    shipPath: "packages/releasedesk-specialists/src/grok-api-intel.ts",
    note: "Webhook preferred; else exclusive-key xAI chat; else MOCK. Shared XAI_API_KEY unused.",
  });
}
