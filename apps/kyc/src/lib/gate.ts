import { NextResponse } from "next/server";
import { StoreConfigError } from "./at-rest";
import { assertDeclaredBodyLimit, BodyTooLargeError } from "./body";
import {
  AuthConfigError,
  credentialFromRequest,
  resolveActor,
  type AuthActor,
  type KycRole,
} from "./auth";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Public 503 text. It must not name configuration variables. */
export const AUTH_NOT_CONFIGURED = "Authentication is not configured.";

export type GateResult = { ok: true; actor: AuthActor } | { ok: false; response: NextResponse };

export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export function bodyLimitResponse(request: Request): NextResponse | null {
  try {
    assertDeclaredBodyLimit(request);
    return null;
  } catch (err) {
    return configFailure(err);
  }
}

export function configFailure(err: unknown): NextResponse | null {
  if (err instanceof AuthConfigError || err instanceof StoreConfigError) {
    return jsonError(AUTH_NOT_CONFIGURED, 503);
  }
  if (err instanceof BodyTooLargeError) {
    return jsonError("Request body is too large.", 413);
  }
  if (err instanceof SyntaxError) {
    return jsonError("Invalid JSON body", 400);
  }
  return null;
}

/** Analyst and customer tokens are not interchangeable. Missing config is 503. */
export async function authorize(request: Request, role: KycRole): Promise<GateResult> {
  return authorizeAny(request, [role]);
}

export async function authorizeAny(request: Request, roles: KycRole[]): Promise<GateResult> {
  try {
    const actor = await resolveActor(credentialFromRequest(request));
    if (!actor) {
      return { ok: false, response: jsonError("Authentication required", 401) };
    }
    if (!roles.includes(actor.role)) {
      return { ok: false, response: jsonError("Forbidden", 403) };
    }
    return { ok: true, actor };
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return { ok: false, response: failure };
    throw err;
  }
}
