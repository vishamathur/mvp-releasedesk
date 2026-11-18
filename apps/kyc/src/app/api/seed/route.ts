import { NextResponse } from "next/server";
import { seedStore } from "@/lib/seed";

export const runtime = "nodejs";

/** Resets the local JSON store with sample Northwind KYC applications. */
export async function POST() {
  const store = await seedStore();
  return NextResponse.json({
    ok: true,
    seededAt: store.seededAt,
    count: store.applications.length,
    applications: store.applications.map((a) => ({
      id: a.id,
      reference: a.reference,
      status: a.status,
      name: a.identity ? `${a.identity.firstName} ${a.identity.lastName}` : null,
    })),
  });
}
