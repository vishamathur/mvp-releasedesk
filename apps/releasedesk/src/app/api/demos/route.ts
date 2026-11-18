import { NextResponse } from "next/server";
import { listDemoScenarios, startDemoScenario } from "@/lib/desk";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ scenarios: listDemoScenarios() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scenarioId?: string;
      mode?: "live" | "fixture";
    };
    if (!body.scenarioId) {
      return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
    }
    const result = await startDemoScenario(body.scenarioId, body.mode ?? "live");
    return NextResponse.json({
      runId: result.view.runId,
      readiness: result.view.leadOutput.readiness,
      scenarioId: result.desk.scenarioId,
      list: result.list,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Demo failed" },
      { status: 400 },
    );
  }
}
