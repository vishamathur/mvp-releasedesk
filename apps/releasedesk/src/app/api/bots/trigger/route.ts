import { NextResponse } from "next/server";
import {
  describeGrokIntelKeyStatus,
  runGrokReleaseIntel,
} from "@/lib/grok-release-intel";

export const runtime = "nodejs";

/**
 * Desk does not orchestrate bot handoffs and does not approve gates.
 * The button shows where to start the Grok Bot flow and runs the shipped
 * Grok intel call so the app key path is exercisable.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    goal?: string;
    repository?: string;
  };

  const intel = await runGrokReleaseIntel({
    repository: body.repository ?? "vishamathur/mvp-releasedesk",
    goal: body.goal ?? "Northwind KYC release readiness",
    findings: [],
  });
  const keyStatus = describeGrokIntelKeyStatus();

  return NextResponse.json({
    ok: true,
    orchestratedByDesk: false,
    autoApproved: false,
    message:
      "Handoffs run inside the Grok Bot app. Desk does not start specialist runs and does not approve finance, security, or release.",
    start: {
      "PID-ER": "Post the intake card in #er-intake. Lead routine on-er-intake opens the thread.",
      "PID-NC":
        "Post the intake card in #new-customer. Lead routine on-nc-intake opens the thread. It does not join the current sprint.",
    },
    humanGates: [
      "finance-approval — Finance partner",
      "security-compliance-approval — human red_team or security",
      "release-gate — Release manager",
      "PID-NC proposal — Customer sponsor",
    ],
    specs: ["docs/sdlc/overview.md", "docs/sdlc/PID-ER.v1.md", "docs/sdlc/PID-NC.v1.md"],
    intel,
    trustCheck: intel.trustCheck,
    keyStatus,
  });
}
