import { NextResponse } from "next/server";
import { getSdlcMvpCatalog, runSdlcMvpPortfolioCheck } from "@/lib/sdlc-mvp";

export const runtime = "nodejs";

/** GET — agent definitions + credential statuses (presence only, never secret values). */
export async function GET() {
  try {
    const catalog = getSdlcMvpCatalog();
    return NextResponse.json({
      agents: catalog.agents,
      credentials: catalog.credentials,
      portfolio: catalog.portfolio,
      requirements: catalog.requirements,
      mockNote:
        "Credential statuses report present/missing only — secret values are never returned.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load SDLC MVP catalog" },
      { status: 500 },
    );
  }
}

/** POST — run portfolio on-demand checks (stubs + MOCK PR). */
export async function POST() {
  try {
    const report = await runSdlcMvpPortfolioCheck();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to run SDLC MVP portfolio check" },
      { status: 500 },
    );
  }
}
