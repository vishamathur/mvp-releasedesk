import { authenticateCredential, AuthConfigError, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError, NO_STORE } from "@/lib/gate";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function sessionCookie(token: string, maxAge: number) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    },
  };
}

export async function POST(request: Request) {
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token === "string") token = body.token;
  } catch {
    return jsonError("Authentication required", 401);
  }
  if (!token || token.length > 256) return jsonError("Authentication required", 401);

  try {
    const actor = authenticateCredential(token);
    if (!actor) return jsonError("Authentication required", 401);
    const response = NextResponse.json(
      { role: actor.role, actorId: actor.actorId },
      { headers: NO_STORE },
    );
    const cookie = sessionCookie(token, SESSION_MAX_AGE_SECONDS);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (err) {
    if (err instanceof AuthConfigError) return jsonError(err.message, 503);
    throw err;
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  const cookie = sessionCookie("", 0);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
