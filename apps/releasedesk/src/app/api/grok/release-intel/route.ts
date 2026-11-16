import { NextResponse } from "next/server";
import {
  classifyReleaseFindings,
  extractReleaseActions,
  scoreReleaseRisk,
  summarizeReleaseFindings,
  type ReleaseFindingInput,
} from "@releasedesk/specialists";

export const runtime = "nodejs";

/**
 * Thin Desk endpoint for the one Cursor→Grok ship path.
 * Implementation: packages/releasedesk-specialists/src/grok-api-intel.ts
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      findings?: ReleaseFindingInput[];
      op?: "all" | "classify" | "extract" | "score" | "summarize";
    };
    const findings = body.findings?.length
      ? body.findings
      : [
          {
            summary: "Demo finding — retention label gap on KYC export",
            sourceAgent: "standards",
            severity: "medium",
          },
        ];
    const op = body.op ?? "all";

    if (op === "classify") {
      return NextResponse.json(await classifyReleaseFindings(findings));
    }
    if (op === "extract") {
      return NextResponse.json(await extractReleaseActions(findings));
    }
    if (op === "score") {
      return NextResponse.json(await scoreReleaseRisk(findings));
    }
    if (op === "summarize") {
      return NextResponse.json(await summarizeReleaseFindings(findings));
    }

    const [classify, extract, score, summarize] = await Promise.all([
      classifyReleaseFindings(findings),
      extractReleaseActions(findings),
      scoreReleaseRisk(findings),
      summarizeReleaseFindings(findings),
    ]);
    return NextResponse.json({
      shipPath: "packages/releasedesk-specialists/src/grok-api-intel.ts",
      keyEnv: "RELEASEDESK_GROK_API_KEY_BUILDER",
      classify,
      extract,
      score,
      summarize,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Release intel failed" },
      { status: 500 },
    );
  }
}
