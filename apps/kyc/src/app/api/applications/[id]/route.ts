import { publicApplication, customerOwns } from "@/lib/access";
import { readJsonBody } from "@/lib/body";
import { advanceReview, updateIdentity } from "@/lib/domain/application";
import type { ApplicationStatus } from "@/lib/domain/types";
import { authorize, authorizeAny, bodyLimitResponse, configFailure, jsonError, NO_STORE } from "@/lib/gate";
import { deleteApplication, getApplication, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const REVIEW_STATUSES = new Set<ApplicationStatus>(["in_review", "approved", "rejected", "needs_info"]);

export async function GET(request: Request, ctx: Ctx) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorizeAny(request, ["analyst", "customer"]);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const application = await getApplication(id);
  if (!application) return jsonError("Not found", 404);
  if (gate.actor.role === "customer" && !customerOwns(application, gate.actor)) {
    return jsonError("Not found", 404);
  }
  return NextResponse.json({ application: publicApplication(application) }, { headers: NO_STORE });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const { id } = await ctx.params;
  let body: {
    identity?: unknown;
    status?: ApplicationStatus;
    note?: unknown;
    /** Ignored. decidedBy is taken from the authenticated analyst (M3). */
    decidedBy?: unknown;
  };
  try {
    body = (await readJsonBody(request)) as typeof body;
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
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
    const gate = await authorize(request, "analyst");
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
      return NextResponse.json({ application: publicApplication(next) }, { headers: NO_STORE });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "Update failed", 400);
    }
  }

  const gate = await authorize(request, "customer");
  if (!gate.ok) return gate.response;
  const existing = await getApplication(id);
  if (!existing || !customerOwns(existing, gate.actor)) return jsonError("Not found", 404);
  try {
    const next = updateIdentity(existing, body.identity);
    await saveApplication(next);
    return NextResponse.json({ application: publicApplication(next) }, { headers: NO_STORE });
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
    return jsonError(err instanceof Error ? err.message : "Update failed", 400);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const override = new URL(request.url).searchParams.get("override") === "approved-retention";
  const result = await deleteApplication(id, gate.actor.actorId, { approvedOverride: override });
  if (!result.deleted && result.reason === "approved") {
    return jsonError("Approved KYC records are kept for the regulatory retention period.", 403);
  }
  if (!result.deleted) return jsonError("Not found", 404);
  return NextResponse.json({ deleted: true, id }, { headers: NO_STORE });
}
