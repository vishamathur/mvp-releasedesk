import { NextResponse } from "next/server";
import {
  describeGrokIntelKeyStatus,
  runGrokReleaseIntel,
} from "@/lib/grok-release-intel";
import { describeAgentCursorCredential } from "@releasedesk/core";

export const runtime = "nodejs";

/** Room-facing key inventory (presence only — never secret values). */
export async function GET() {
  const grok = describeGrokIntelKeyStatus();
  const cursor = (["coding", "testing", "review"] as const).map((id) => {
    const status = describeAgentCursorCredential(id);
    return {
      agentId: id,
      envVar: status.envVar,
      present: status.present,
      role:
        id === "coding"
          ? "ships Grok release-intel code"
          : id === "testing"
            ? "verifies — never merges"
            : "reviews — never merges",
    };
  });
  const cloudClient = String(process.env.RELEASEDESK_CLOUD_CLIENT ?? "mock").toLowerCase();

  return NextResponse.json({
    ok: true,
    grokIntel: grok,
    cursorCloudAgents: cursor,
    cloudClientMode: cloudClient === "real" ? "real" : "mock",
    exclusiveKeysOnly: true,
    forbiddenSharedFallbacks: [
      "XAI_API_KEY",
      "GROK_API_KEY",
      "CURSOR_API_KEY",
      "CURSOR_SERVICE_ACCOUNT_KEY",
    ],
    roomHint: grok.liveReady
      ? "Grok intel will label LIVE"
      : `Grok intel will label MOCK until ${grok.keyEnvVar} is set`,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    repository?: string;
    goal?: string;
    findings?: Array<{ source: string; text: string; severity?: string }>;
  };

  const intel = await runGrokReleaseIntel({
    repository: body.repository ?? "vishamathur/mvp-releasedesk",
    goal: body.goal ?? "Release readiness",
    findings: body.findings ?? [],
  });
  const keyStatus = describeGrokIntelKeyStatus();
  return NextResponse.json({
    ok: true,
    intel,
    keyStatus,
    showcase: {
      label: intel.label,
      mocked: intel.mocked,
      exclusiveKey: intel.trustCheck.keyEnvVar,
      talkTrack:
        intel.label === "LIVE"
          ? `Live call via exclusive ${intel.trustCheck.keyEnvVar}; trustCheck keeps humans in charge.`
          : `MOCK labeled — set ${intel.trustCheck.keyEnvVar} for LIVE (shared XAI/GROK keys ignored).`,
    },
  });
}
