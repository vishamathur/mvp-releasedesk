import { createDraftApplication } from "@/lib/domain/application";
import { authorize, jsonError, NO_STORE } from "@/lib/gate";
import { listApplications, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const applications = await listApplications();
  return NextResponse.json({ applications }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const gate = authorize(request, "customer");
  if (!gate.ok) return gate.response;
  try {
    const body = (await request.json()) as { identity?: unknown };
    if (!body || typeof body !== "object" || body.identity == null) {
      return jsonError("identity is required", 400);
    }
    const app = createDraftApplication({ identity: body.identity }, undefined, gate.actor.actorId);
    await saveApplication(app);
    return NextResponse.json({ application: app }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to create application", 400);
  }
}
