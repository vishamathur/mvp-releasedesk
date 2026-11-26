import { advanceReview, updateIdentity } from "@/lib/domain/application";
import type { ApplicationStatus } from "@/lib/domain/types";
import { authorize, jsonError, NO_STORE } from "@/lib/gate";
import { customerOwns } from "@/lib/access";
import { deleteApplication, getApplication, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const REVIEW_STATUSES = new Set<ApplicationStatus>(["in_review", "approved", "rejected", "needs_info"]);

export async function GET(request: Request, ctx: Ctx) {
  const gate = authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const application = await getApplication(id);
  if (!application) return jsonError("Not found", 404);
  return NextResponse.json({ application }, { headers: NO_STORE });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: {
    identity?: unknown;
    status?: ApplicationStatus;
    note?: unknown;
    /** Ignored. decidedBy is taken from the authenticated analyst (M3). */
    decidedBy?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Invalid JSON body", 400);
  }

  const hasIdentity = body.identity != null;
  const hasStatus = body.status != null;
  if (hasIdentity && hasStatus) {
    return jsonError("Identity updates and analyst decisions must be separate requests", 400);
  }
  if (!hasIdentity && !hasStatus) {
    return jsonError("identity or status is required", 400);
  }

  if (hasStatus) {
    const gate = authorize(request, "analyst");
    if (!gate.ok) return gate.response;
    if (!REVIEW_STATUSES.has(body.status as ApplicationStatus)) {
      return jsonError("status is not an analyst decision", 400);
    }
    if (body.note !== undefined && typeof body.note !== "string") {
      return jsonError("note must be a string", 400);
    }
    if (typeof body.note === "string" && body.note.length > 500) {
      return jsonError("note must be at most 500 characters.", 400);
    }
    const existing = await getApplication(id);
    if (!existing) return jsonError("Not found", 404);
    try {
      const next = advanceReview(
        existing,
        body.status as "in_review" | "approved" | "rejected" | "needs_info",
        gate.actor.actorId,
        typeof body.note === "string" ? body.note : undefined,
      );
      await saveApplication(next);
      return NextResponse.json({ application: next }, { headers: NO_STORE });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "Update failed", 400);
    }
  }

  const gate = authorize(request, "customer");
  if (!gate.ok) return gate.response;
  const existing = await getApplication(id);
  if (!existing || !customerOwns(existing, gate.actor)) return jsonError("Not found", 404);
  try {
    const next = updateIdentity(existing, body.identity);
    await saveApplication(next);
    return NextResponse.json({ application: next }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Update failed", 400);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const gate = authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const removed = await deleteApplication(id, gate.actor.actorId);
  if (!removed) return jsonError("Not found", 404);
  return NextResponse.json({ deleted: true, id }, { headers: NO_STORE });
}
