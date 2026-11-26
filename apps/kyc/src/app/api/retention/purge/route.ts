import { authorize, bodyLimitResponse, NO_STORE } from "@/lib/gate";
import {
  DEFAULT_APPROVED_RETENTION_DAYS,
  PII_RETENTION_DAYS,
  PII_RETENTION_POLICY,
  purgeExpiredApplications,
} from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Analyst-only purge. Drafts and rejections use 90 days. Approved records use the longer window. */
export async function POST(request: Request) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const deletedIds = await purgeExpiredApplications(gate.actor.actorId);
  return NextResponse.json(
    {
      policy: PII_RETENTION_POLICY,
      draftAndRejectedRetentionDays: PII_RETENTION_DAYS,
      approvedRetentionDaysDefault: DEFAULT_APPROVED_RETENTION_DAYS,
      deletedIds,
      actorId: gate.actor.actorId,
    },
    { headers: NO_STORE },
  );
}
