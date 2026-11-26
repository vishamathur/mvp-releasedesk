import { authorize, NO_STORE } from "@/lib/gate";
import { PII_RETENTION_DAYS, PII_RETENTION_POLICY, purgeExpiredApplications } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Analyst-only purge of applications past the northwind-data-retention window. */
export async function POST(request: Request) {
  const gate = authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const deletedIds = await purgeExpiredApplications(gate.actor.actorId);
  return NextResponse.json(
    {
      policy: PII_RETENTION_POLICY,
      retentionDays: PII_RETENTION_DAYS,
      deletedIds,
      actorId: gate.actor.actorId,
    },
    { headers: NO_STORE },
  );
}
