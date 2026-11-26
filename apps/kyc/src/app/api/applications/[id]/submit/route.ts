import { submitApplication } from "@/lib/domain/application";
import { customerOwns } from "@/lib/access";
import { authorize, jsonError, NO_STORE } from "@/lib/gate";
import { getApplication, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const gate = authorize(request, "customer");
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const existing = await getApplication(id);
  if (!existing || !customerOwns(existing, gate.actor)) {
    return jsonError("Not found", 404);
  }

  try {
    const application = submitApplication(existing);
    await saveApplication(application);
    return NextResponse.json(
      {
        application,
        mock: {
          note: "Risk screening is local/demo only. No external identity verification or sanctions API was called.",
        },
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Submit failed", 400);
  }
}
