import { NextResponse } from "next/server";
import { runGrokReleaseIntel } from "@/lib/grok-release-intel";
import { getRun } from "@/lib/desk";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    repository?: string;
    goal?: string;
    findings?: Array<{ source: string; text: string; severity?: string }>;
  };

  let findings = body.findings ?? [];
  let repository = body.repository ?? "vishamathur/mvp-releasedesk";
  let goal = body.goal ?? "Release readiness";

  if (body.runId) {
    const data = await getRun(body.runId);
    if (!data) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    repository = String(data.view.run.target.repository ?? repository);
    goal = data.view.run.goal ?? goal;
    if (findings.length === 0) {
      findings = data.view.run.tasks
        .filter((t) => t.agentRole !== "lead")
        .map((t) => ({
          source: String(t.agentRole),
          text: String(t.output?.summary ?? t.name),
          severity: String(
            (t.output as { riskLevel?: string } | null)?.riskLevel ??
              (t.output as { overallImpact?: string } | null)?.overallImpact ??
              "medium",
          ),
        }));
    }
  }

  const intel = await runGrokReleaseIntel({ repository, goal, findings });
  return NextResponse.json({ ok: true, intel });
}
