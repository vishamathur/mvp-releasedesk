import { publicApplication } from "@/lib/access";
import { generateApplicantCredential, SESSION_COOKIE_NAME } from "@/lib/auth";
import { readJsonBody } from "@/lib/body";
import { createDraftApplication } from "@/lib/domain/application";
import { authorize, bodyLimitResponse, configFailure, jsonError, NO_STORE } from "@/lib/gate";
import { listApplications, saveApplication } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export async function GET(request: Request) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorize(request, "analyst");
  if (!gate.ok) return gate.response;
  const applications = await listApplications();
  return NextResponse.json(
    { applications: applications.map(publicApplication) },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const limited = bodyLimitResponse(request);
  if (limited) return limited;
  const gate = await authorize(request, "customer");
  if (!gate.ok) return gate.response;
  try {
    const body = (await readJsonBody(request)) as { identity?: unknown };
    if (!body || typeof body !== "object" || body.identity == null) {
      return jsonError("identity is required", 400);
    }
    const credential = generateApplicantCredential();
    const app = createDraftApplication({ identity: body.identity }, undefined, credential.actorId);
    app.applicantCredentialHash = credential.credentialHash;
    await saveApplication(app);
    const response = NextResponse.json(
      { application: publicApplication(app), applicantCredential: credential.token },
      { status: 201, headers: NO_STORE },
    );
    response.cookies.set(SESSION_COOKIE_NAME, credential.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    const failure = configFailure(err);
    if (failure) return failure;
    return jsonError(err instanceof Error ? err.message : "Failed to create application", 400);
  }
}
