import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { listApplications } from "./store";

export type KycRole = "customer" | "analyst";

export interface AuthActor {
  role: KycRole;
  actorId: string;
}

/** Shared intake session. It can start a case. It does not own any case. */
export const INTAKE_ACTOR_ID = "customer:intake";

export interface ApplicantCredential {
  token: string;
  actorId: string;
  credentialHash: string;
}

/** HttpOnly session cookie set by POST /api/auth/session. Value is the bearer token. */
export const SESSION_COOKIE_NAME = "kyc_session";

const MIN_TOKEN_LENGTH = 16;
const ACTOR_RE = /^[A-Za-z0-9:._-]{1,64}$/;

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function requireToken(name: string, value: string | undefined): string {
  const token = value ?? "";
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new AuthConfigError(
      `${name} must be set to a token of at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }
  if (/[\s;]/.test(token)) {
    throw new AuthConfigError(`${name} must not contain whitespace or semicolons.`);
  }
  return token;
}

export function assertAuthConfigured(): { customer: string; analyst: string } {
  const customer = requireToken("KYC_CUSTOMER_TOKEN", process.env.KYC_CUSTOMER_TOKEN);
  const analyst = requireToken("KYC_ANALYST_TOKEN", process.env.KYC_ANALYST_TOKEN);
  if (safeEqual(customer, analyst)) {
    throw new AuthConfigError("KYC_CUSTOMER_TOKEN and KYC_ANALYST_TOKEN must be different.");
  }
  return { customer, analyst };
}

function analystActorId(): string {
  const value = process.env.KYC_ANALYST_ACTOR_ID?.trim() || "analyst:northwind-demo";
  if (!ACTOR_RE.test(value)) {
    throw new AuthConfigError("Analyst actor id is invalid.");
  }
  return value;
}

export function hashApplicantCredential(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** One random credential per case. Only the hash is stored. */
export function generateApplicantCredential(): ApplicantCredential {
  const token = randomBytes(32).toString("base64url");
  const actorId = `applicant:${randomBytes(8).toString("hex")}`;
  return { token, actorId, credentialHash: hashApplicantCredential(token) };
}

function hashesMatch(stored: string, computed: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(stored) || stored.length !== computed.length) return false;
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(computed, "hex"));
}

/**
 * Match a bearer token or session cookie value to a customer or analyst actor.
 * Returns null when the credential is missing or wrong. Throws AuthConfigError
 * when the demo tokens are not configured (fail closed — never open access).
 */
export function authenticateCredential(credential: string | null | undefined): AuthActor | null {
  const { customer, analyst } = assertAuthConfigured();
  if (!credential) return null;
  const presented = credential.trim();
  if (!presented) return null;
  const customerOk = safeEqual(presented, customer);
  const analystOk = safeEqual(presented, analyst);
  if (analystOk) return { role: "analyst", actorId: analystActorId() };
  if (customerOk) return { role: "customer", actorId: INTAKE_ACTOR_ID };
  return null;
}

/**
 * Env tokens resolve first. Any other credential is matched to a single case
 * by the stored SHA-256 of the applicant token issued at creation.
 */
export async function resolveActor(credential: string | null | undefined): Promise<AuthActor | null> {
  const direct = authenticateCredential(credential);
  if (direct || !credential?.trim()) return direct;
  const hash = hashApplicantCredential(credential.trim());
  const applications = await listApplications();
  for (const application of applications) {
    if (
      application.applicantCredentialHash &&
      application.createdBy &&
      hashesMatch(application.applicantCredentialHash, hash)
    ) {
      return { role: "customer", actorId: application.createdBy };
    }
  }
  return null;
}

export function credentialFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (match?.[1]) return match[1];
    if (/^Bearer\b/i.test(header)) return null;
  }
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== SESSION_COOKIE_NAME) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
