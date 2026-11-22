import { NextResponse } from "next/server";
import { startOnDemandCheck } from "@/lib/desk";
import {
  describeGrokIntelKeyStatus,
  runGrokReleaseIntel,
} from "@/lib/grok-release-intel";
import { buildSpaceXaiComplianceSnapshot } from "@/lib/spacexai-compliance";

export const runtime = "nodejs";

/**
 * Challenge trigger: Lead-style on-demand check + Grok API release intel.
 * Returns SpaceXAI LIVE/MOCK chips + trustCheck evidence (never secret values).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    goal?: string;
    repository?: string;
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
  const keyStatus = describeGrokIntelKeyStatus();

  const iterationGate = started.iterationGate ?? null;

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
    keyStatus,
    showcase: {
      label: intel.label,
      mocked: intel.mocked,
      exclusiveKey: intel.trustCheck.keyEnvVar,
      talkTrack:
        intel.label === "LIVE"
          ? `Say: LIVE via exclusive ${intel.trustCheck.keyEnvVar}; trustCheck keeps humans in charge.`
          : `Say: MOCK labeled — set ${intel.trustCheck.keyEnvVar} for LIVE; shared XAI/GROK keys are ignored.`,
    },
    list: started.list,
  });
}
