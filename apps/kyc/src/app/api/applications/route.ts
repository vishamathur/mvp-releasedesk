import { NextResponse } from "next/server";
import { createDraftApplication } from "@/lib/domain/application";
import type { Identity } from "@/lib/domain/types";
import { listApplications, saveApplication } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const applications = await listApplications();
  return NextResponse.json({ applications });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { identity?: Identity };
    if (!body.identity) {
      return NextResponse.json({ error: "identity is required" }, { status: 400 });
    }
    const app = createDraftApplication({ identity: body.identity });
    await saveApplication(app);
    return NextResponse.json({ application: app }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create application" },
      { status: 400 },
    );
  }
}
