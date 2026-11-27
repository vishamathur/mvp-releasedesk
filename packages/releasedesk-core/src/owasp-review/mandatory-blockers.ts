/**
 * Mandatory blockers for the OWASP review.
 *
 * Some findings must be fixed before a change moves on, whatever severity the model gave them.
 * This module decides that in code from the control id, the CWE id, the severity and the
 * wording of a finding. The model's severity can add a blocker. It can never remove one.
 *
 * The OWASP check fails when any confirmed failure is a mandatory blocker. The check result is
 * a CI gate. Grok stays advisory for merge and release decisions, and the human gates are unchanged.
 */
import type { OwaspControlId } from "./catalogue.js";
import { isTestFixturePath } from "./static-checks.js";
import type { OwaspSeverity } from "./types.js";

/** Controls where any confirmed failure blocks. */
export const MANDATORY_CONTROL_IDS: readonly OwaspControlId[] = [
  "A07", // Identification and Authentication Failures
  "A01", // Broken Access Control
  "X06", // API object-level authorization
];

/** CWE ids that always block, with a short name for the report. */
export const MANDATORY_CWES: Readonly<Record<number, string>> = {
  259: "hard-coded password",
  284: "improper access control",
  287: "improper authentication",
  288: "authentication bypass using an alternate path",
  306: "missing authentication for a critical function",
  307: "excessive authentication attempts",
  384: "session fixation",
  521: "weak password requirements",
  613: "insufficient session expiration",
  639: "authorization bypass through user-controlled key",
  798: "hard-coded credentials",
  799: "improper control of interaction frequency",
  862: "missing authorization",
  863: "incorrect authorization",
};

/** Severities that always block. */
export const MANDATORY_SEVERITIES: readonly OwaspSeverity[] = ["high", "critical"];

export type MandatoryInput = {
  id: string;
  severity: OwaspSeverity;
  path: string;
  evidence: string;
  /** Text of the suggested fix, when there is one. */
  fixText?: string;
  /** CWE id the reviewer gave, such as CWE-307. Empty or missing is fine. */
  cwe?: string | null;
};

export type MandatoryVerdict = {
  mandatory: boolean;
  /** Plain reasons, such as "A07", "CWE-307" or "severity high". Empty when not mandatory. */
  reasons: string[];
  /** CWE ids found on the finding, such as ["CWE-307"]. */
  cwes: string[];
};

const FIXTURE_DIR = /(?:^|\/)(?:fixtures?|__tests__|__mocks__|tests?|examples?)\//;

function isFixturePath(path: string): boolean {
  return isTestFixturePath(path) || FIXTURE_DIR.test(path);
}

/** Read CWE ids from the reviewer's field and from the finding text. */
export function extractCwes(...texts: ReadonlyArray<string | null | undefined>): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(/\bCWE[-\s:]?(\d{1,4})\b/gi)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) found.add(value);
    }
  }
  return [...found].sort((a, b) => a - b);
}

const BRUTE_FORCE = /\b(?:brute[- ]?forc\w*|credential[- ]stuffing|password[- ]spraying)\b/i;
const SESSION_FIXATION = /\bsession[- ]fixation\b/i;
const AUTH_BYPASS =
  /\bauth\w*[- ]bypass\w*|\bbypass(?:es|ed|ing)?\s+(?:the\s+|any\s+)?(?:auth\w*|login|sign-?in|lock-?out|rate[- ]?limit\w*|throttl\w*)/i;
const LOCKOUT_OF_OTHERS =
  /\block(?:ed|s|ing)?[- ]?out\b.{0,60}\b(?:other|every|all|valid|legitimate|any)\s+(?:users?|applicants?|customers?|clients?|accounts?)\b/i;
const THROTTLE_WORDS = /\block(?:ed|s|ing)?[- ]?out\b|\blockouts?\b|\brate[- ]?limit\w*|\b\w*throttl\w*/i;
const AUTH_WORDS = /\bauth\w*|\blogin\b|\bsign-?in\b|\bpassword\w*|\bcredential\w*|\btokens?\b|\botp\b|\bguess\w*/i;
const ABSENCE_WORDS =
  /\b(?:no|not|never|missing|without|unthrottled|unlimited|unbounded|bypass\w*|cosmetic|ineffective|does not|doesn't|cannot|can't)\b/i;

/** Wording that describes a mandatory category, whatever control id the model used. */
export function mandatoryWording(text: string): string | null {
  if (BRUTE_FORCE.test(text)) return "brute force or credential stuffing";
  if (SESSION_FIXATION.test(text)) return "session fixation";
  if (AUTH_BYPASS.test(text)) return "authentication bypass";
  if (LOCKOUT_OF_OTHERS.test(text)) return "lockout of other users";
  if (THROTTLE_WORDS.test(text) && AUTH_WORDS.test(text) && ABSENCE_WORDS.test(text)) {
    return "missing or bypassable lockout or rate limit on authentication";
  }
  return null;
}

/** Decide whether a confirmed failure is a mandatory blocker. */
export function classifyMandatory(input: MandatoryInput): MandatoryVerdict {
  const reasons: string[] = [];
  const fixture = isFixturePath(input.path);
  const text = `${input.evidence} ${input.fixText ?? ""}`;
  const cwes = extractCwes(input.cwe, text);

  if (MANDATORY_SEVERITIES.includes(input.severity)) reasons.push(`severity ${input.severity}`);
  if ((MANDATORY_CONTROL_IDS as readonly string[]).includes(input.id)) reasons.push(`control ${input.id}`);
  if (input.id === "X01" && !fixture) reasons.push("control X01 hard-coded secret in a production path");
  if (input.id === "X03" && SESSION_FIXATION.test(text)) reasons.push("session fixation");
  for (const cwe of cwes) {
    if (!(cwe in MANDATORY_CWES)) continue;
    const secretCwe = cwe === 798 || cwe === 259;
    if (secretCwe && fixture) continue;
    reasons.push(`CWE-${cwe} ${MANDATORY_CWES[cwe]}`);
  }
  const wording = mandatoryWording(text);
  if (wording) reasons.push(wording);

  return { mandatory: reasons.length > 0, reasons, cwes: cwes.map((cwe) => `CWE-${cwe}`) };
}

/** Exit code for the OWASP check. 1 when the review failed or a mandatory blocker is open. */
export function owaspCheckExitCode(report: {
  status: string;
  failures: ReadonlyArray<{ mandatory?: boolean }>;
}): number {
  if (report.status === "failed") return 1;
  return report.failures.some((failure) => failure.mandatory === true) ? 1 : 0;
}
