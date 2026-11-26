import { authenticateCredential, AuthConfigError, SESSION_COOKIE_NAME, type AuthActor, type KycRole } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function currentActor(): Promise<AuthActor | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  return authenticateCredential(token);
}

function loginPath(nextPath: string, reason?: string): string {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  params.set("next", nextPath);
  return `/login?${params.toString()}`;
}

/** Server pages. Customer and analyst surfaces redirect to sign-in rather than rendering PII. */
export async function requirePageActor(role: KycRole | "either", nextPath: string): Promise<AuthActor> {
  try {
    const actor = await currentActor();
    if (!actor) redirect(loginPath(nextPath));
    if (role !== "either" && actor.role !== role) redirect(loginPath(nextPath, role));
    return actor;
  } catch (err) {
    if (err instanceof AuthConfigError) redirect(loginPath(nextPath, "config"));
    throw err;
  }
}
