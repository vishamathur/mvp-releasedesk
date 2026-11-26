import { resolveActor, SESSION_COOKIE_NAME } from "@/lib/auth";
import { readJsonBody } from "@/lib/body";
import { bodyLimitResponse, configFailure, jsonError, NO_STORE } from "@/lib/gate";
import {
  clearSessionFailures,
  recordSessionFailure,
  sessionClientKeys,
  sessionIsLocked,
} from "@/lib/session-lockout";
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
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  let token = "";
  try {
    const body = (await readJsonBody(request)) as { token?: unknown };
    if (typeof body.token === "string") token = body.token;
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
    return jsonError("Authentication required", 401);
  }
  if (!token || token.length > 256) return jsonError("Authentication required", 401);

  const keys = sessionClientKeys(request, token);
  if (sessionIsLocked(keys)) {
    return jsonError("Too many sign-in attempts. Try again later.", 429);
  }

  try {
    const actor = await resolveActor(token);
    if (!actor) {
      if (recordSessionFailure(keys)) {
        return jsonError("Too many sign-in attempts. Try again later.", 429);
      }
      return jsonError("Authentication required", 401);
    }
    clearSessionFailures(keys);
    const response = NextResponse.json(
      { role: actor.role, actorId: actor.actorId },
      { headers: NO_STORE },
    );
    const cookie = sessionCookie(token, SESSION_MAX_AGE_SECONDS);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
    throw err;
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  const cookie = sessionCookie("", 0);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
