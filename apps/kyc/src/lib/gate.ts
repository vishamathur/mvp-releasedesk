import { NextResponse } from "next/server";
import {
  AuthConfigError,
  authenticateCredential,
  credentialFromRequest,
  type AuthActor,
  type KycRole,
} from "./auth";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type GateResult = { ok: true; actor: AuthActor } | { ok: false; response: NextResponse };

export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** Analyst and customer tokens are not interchangeable. Missing config is 503. */
export function authorize(request: Request, role: KycRole): GateResult {
  try {
    const actor = authenticateCredential(credentialFromRequest(request));
    if (!actor) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }
    if (actor.role !== role) {
      return { ok: false, response: jsonError("Forbidden", 403) };
    }
    return { ok: true, actor };
  } catch (err) {
    if (err instanceof AuthConfigError) {
      return { ok: false, response: jsonError(err.message, 503) };
    }
    throw err;
  }
}
