import { NextResponse } from "next/server";
import { startOnDemandCheck, applyIterationGateDecision } from "@/lib/desk";
import { runGrokReleaseIntel } from "@/lib/grok-release-intel";
import { buildSpaceXaiComplianceSnapshot } from "@/lib/spacexai-compliance";

export const runtime = "nodejs";

/**
 * Challenge trigger: Lead-style on-demand check + Grok API release intel.
 * Mirrors Grok Bot Lead routine `on-demand-release` for Desk live walkthrough.
 * Returns SpaceXAI LIVE/MOCK chips + trustCheck evidence (never secret values).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    goal?: string;
    repository?: string;
    /** When true, also exercise security iteration sign-off (demo). */
    autoOpenIterationGate?: boolean;
  };

  const started = await startOnDemandCheck({
    goal: body.goal ?? "SpaceXAI challenge: Northwind KYC release readiness",
    repository: body.repository ?? "vishamathur/mvp-releasedesk",
    requestedBy: "grok-bot-lead",
  });

  const findings = started.view.run.tasks
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

  const intel = await runGrokReleaseIntel({
    repository: body.repository ?? "vishamathur/mvp-releasedesk",
    goal: started.view.run.goal,
    findings,
  });

  let iterationGate = started.desk.iterationGate
    ? started.iterationGate
    : null;

  if (body.autoOpenIterationGate !== false && started.desk.iterationGate) {
    const opened = await applyIterationGateDecision({
      runId: started.view.runId,
      decision: "approved",
      kind: "security",
      decidedBy: "challenge-trigger",
      note: "Challenge path: security sign-off so merge/release can be exercised",
    });
    iterationGate = opened.iterationGate;
  }

  const compliance = buildSpaceXaiComplianceSnapshot(process.env, { intel });

  return NextResponse.json({
    ok: true,
    handoffs: [
      "Lead → Change Analyst / Standards / Security (parallel)",
      "Lead → Builder (if remediation)",
      "Builder → Cursor Coding (ships Grok intel) → Testing ∥ Review (never merge)",
      "Shipped path → Grok API release intel (classify / extract / score / summarize + trustCheck)",
      "Human: iteration gate (red_team|security) → feature sign-off → merge → release",
    ],
    runId: started.view.runId,
    runUrl: `/runs/${started.view.runId}`,
    readiness: started.view.leadOutput.readiness,
    iterationGate,
    intel,
    chips: compliance.chips,
    compliancePct: compliance.compliancePct,
    nhiMissing: compliance.nhiSlots.missing,
    trustCheck: intel.trustCheck,
    list: started.list,
  });
}
