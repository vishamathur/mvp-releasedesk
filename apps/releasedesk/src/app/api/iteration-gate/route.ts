import { NextResponse } from "next/server";
import {
  evaluateIterationProceedGate,
  type IterationApproval,
  type IterationApprovalKind,
} from "@releasedesk/core";

export const runtime = "nodejs";

/** In-memory demo gate for /mvp (process-local). Run-scoped gate remains on /runs/[id]. */
const store = new Map<
  string,
  { iterationId: string; title: string; approvals: IterationApproval[] }
>();

function ensureDemo(iterationId = "iter_mvp_demo") {
  let row = store.get(iterationId);
  if (!row) {
    row = {
      iterationId,
      title: "Code iteration — red_team | security gate",
      approvals: [],
    };
    store.set(iterationId, row);
  }
  return row;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const iterationId = url.searchParams.get("iterationId") ?? "iter_mvp_demo";
  const row = ensureDemo(iterationId);
  const gate = evaluateIterationProceedGate({
    iterationId: row.iterationId,
    approvals: row.approvals,
  });
  return NextResponse.json({ ...row, gate });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      iterationId?: string;
      kind?: IterationApprovalKind;
      approvedBy?: string;
      note?: string;
      reset?: boolean;
    };
    const iterationId = body.iterationId ?? "iter_mvp_demo";
    if (body.reset) {
      store.set(iterationId, {
        iterationId,
        title: "Code iteration — red_team | security gate",
        approvals: [],
      });
    }
    const row = ensureDemo(iterationId);
    if (!body.reset) {
      const kind = body.kind ?? "security";
      if (kind !== "red_team" && kind !== "security") {
        return NextResponse.json({ error: "kind must be red_team|security" }, { status: 400 });
      }
      const approval: IterationApproval = {
        iterationId,
        kind,
        approvedBy: body.approvedBy?.trim() || "desk-operator",
        approvedAt: new Date().toISOString(),
        ...(body.note !== undefined ? { note: body.note } : {}),
      };
      row.approvals = [...row.approvals.filter((a) => a.kind !== kind), approval];
    }
    const gate = evaluateIterationProceedGate({
      iterationId: row.iterationId,
      approvals: row.approvals,
    });
    return NextResponse.json({ ...row, gate });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gate update failed" },
      { status: 500 },
    );
  }
}
