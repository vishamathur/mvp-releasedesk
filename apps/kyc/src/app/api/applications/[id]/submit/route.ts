import { NextResponse } from "next/server";
import { submitApplication } from "@/lib/domain/application";
import { getApplication, saveApplication } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const application = submitApplication(existing);
    await saveApplication(application);
    return NextResponse.json({
      application,
      mock: {
        note: "Risk screening is local/demo only. No external identity verification or sanctions API was called.",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Submit failed" },
      { status: 400 },
    );
  }
}
