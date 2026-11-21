import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Retired. Desk no longer starts a Lead orchestrator run.
 * Open #er-intake or #new-customer in the Grok Bot app.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      orchestratedByDesk: false,
      autoApproved: false,
      error:
        "Desk no longer orchestrates bot handoffs. Post an intake card in #er-intake (PID-ER) or #new-customer (PID-NC). See docs/sdlc/overview.md.",
    },
    { status: 410 },
  );
}
