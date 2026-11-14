import type { Identity, RiskAssessment, RiskLevel } from "./types";

/** High-risk nationality codes used only for demo scoring (not real policy). */
const ELEVATED_NATIONALITIES = new Set(["XX", "ZZ"]);

/** Countries treated as higher-risk residency for the demo rule engine. */
const ELEVATED_RESIDENCE = new Set(["XX", "ZZ"]);

export interface RiskInput {
  identity: Identity;
  documentCount: number;
  hasSelfie: boolean;
  now?: Date;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Deterministic demo risk engine.
 * MOCK: does not call sanctions, PEP, or credit bureaus.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const now = input.now ?? new Date();
  const factors: string[] = [];
  let score = 15;

  const birth = new Date(`${input.identity.dateOfBirth}T00:00:00.000Z`);
  const age =
    now.getUTCFullYear() -
    birth.getUTCFullYear() -
    (now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
      ? 1
      : 0);

  if (age < 21) {
    score += 10;
    factors.push("Applicant under 21");
  } else if (age >= 75) {
    score += 8;
    factors.push("Applicant age 75+");
  }

  if (ELEVATED_NATIONALITIES.has(input.identity.nationality)) {
    score += 35;
    factors.push("Elevated nationality flag (demo list)");
  }

  if (ELEVATED_RESIDENCE.has(input.identity.country)) {
    score += 25;
    factors.push("Elevated residence country (demo list)");
  }

  if (input.identity.nationality !== input.identity.country) {
    score += 12;
    factors.push("Nationality differs from residence country");
  }

  if (input.documentCount < 2) {
    score += 20;
    factors.push("Fewer than two supporting documents");
  } else if (input.documentCount >= 3) {
    score -= 5;
    factors.push("Multiple supporting documents provided");
  }

  if (!input.hasSelfie) {
    score += 10;
    factors.push("No selfie / liveness placeholder");
  } else {
    score -= 5;
    factors.push("Selfie placeholder present");
  }

  const emailDomain = input.identity.email.split("@")[1]?.toLowerCase() ?? "";
  if (emailDomain.endsWith(".test") || emailDomain.includes("temp")) {
    score += 15;
    factors.push("Disposable / test email domain pattern");
  }

  score = clampScore(score);
  const level = levelFromScore(score);

  if (factors.length === 0) {
    factors.push("No elevated risk signals");
  }

  return {
    level,
    score,
    factors,
    assessedAt: now.toISOString(),
    mockScreeningNote:
      "MOCK: Sanctions/PEP screening skipped — local rule engine only. No external identity verification API was called.",
  };
}
