import { NextResponse } from "next/server";
import { applyFeatureSignOffDecision } from "@/lib/desk";
import type { FeatureSignOffItemId } from "@releasedesk/lead";

export const runtime = "nodejs";

type Props = { params: Promise<{ runId: string }> };

const ITEM_IDS = new Set([
  "intent_match",
  "manual_code_review",
  "behavior_verified",
  "tests_adequate",
  "security_basics",
  "no_secrets",
]);

export async function POST(request: Request, { params }: Props) {
  const { runId } = await params;
  try {
    const body = (await request.json()) as {
      checklistId?: string;
      itemId?: string;
      signOffAll?: boolean;
      signedOffBy?: string;
      notes?: string;
    };
    if (!body.checklistId) {
      return NextResponse.json({ error: "checklistId is required" }, { status: 400 });
    }
    if (!body.signOffAll && !body.itemId) {
      return NextResponse.json(
        { error: "itemId or signOffAll is required" },
        { status: 400 },
      );
    }
    if (body.itemId && !ITEM_IDS.has(body.itemId)) {
      return NextResponse.json({ error: `Unknown itemId: ${body.itemId}` }, { status: 400 });
    }

    const result = await applyFeatureSignOffDecision({
      runId,
      checklistId: body.checklistId,
      ...(body.itemId !== undefined ? { itemId: body.itemId as FeatureSignOffItemId } : {}),
      ...(body.signOffAll ? { signOffAll: true } : {}),
      ...(body.signedOffBy !== undefined ? { signedOffBy: body.signedOffBy } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });

    return NextResponse.json({
      runId: result.view.runId,
      readiness: result.view.leadOutput.readiness,
      featureSignOffs: result.view.featureSignOffs,
      approvals: result.view.approvals,
      blockingIssues: result.view.leadOutput.blockingIssues,
      list: result.list,
      autoMerge: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Feature sign-off failed" },
      { status: 400 },
    );
  }
}
