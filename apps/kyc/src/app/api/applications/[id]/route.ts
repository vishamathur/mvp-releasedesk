import { NextResponse } from "next/server";
import { advanceReview, updateIdentity } from "@/lib/domain/application";
import type { ApplicationStatus, Identity } from "@/lib/domain/types";
import { getApplication, saveApplication } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ application });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      identity?: Identity;
      status?: Extract<ApplicationStatus, "in_review" | "approved" | "rejected" | "needs_info">;
      note?: string;
    };

    let next = existing;
    if (body.identity) {
      next = updateIdentity(next, body.identity);
    }
    if (body.status) {
      next = advanceReview(next, body.status, body.note);
    }
    await saveApplication(next);
    return NextResponse.json({ application: next });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 },
    );
  }
}
