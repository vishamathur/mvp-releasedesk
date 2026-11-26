import { authorize, jsonError, NO_STORE } from "@/lib/gate";
import { seedStore } from "@/lib/seed";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Replaces the local encrypted store with synthetic Northwind KYC applications.
 * Analyst auth is required. Disabled in production and unless KYC_SEED_ENABLED=true.
 * The response lists references only — not identity fields.
 */
export async function POST(request: Request) {
  const gate = authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  if (process.env.NODE_ENV === "production") {
    return jsonError("Seed is disabled in production.", 403);
  }
  if (process.env.KYC_SEED_ENABLED !== "true") {
    return jsonError("Seed is disabled. Set KYC_SEED_ENABLED=true outside production.", 403);
  }
  const store = await seedStore(new Date(), gate.actor.actorId);
  return NextResponse.json(
    {
      ok: true,
      seededAt: store.seededAt,
      count: store.applications.length,
      applications: store.applications.map((application) => ({
        id: application.id,
        reference: application.reference,
        status: application.status,
      })),
    },
    { headers: NO_STORE },
  );
}
