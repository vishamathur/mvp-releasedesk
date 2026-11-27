/**
 * High-confidence static checks. They only emit a FAIL for an added line
 * of a control the selector already chose. Grok still judges that control.
 */
import { addedLines } from "./diff.js";
import type { OwaspControlId } from "./catalogue.js";
import type { DiffFile, OwaspSeverity, OwaspSuggestedFix } from "./types.js";

export type StaticFinding = {
  id: OwaspControlId;
  path: string;
  line: number;
  evidence: string;
  severity: OwaspSeverity;
  autoFixable: true;
  suggestedFix: OwaspSuggestedFix;
};

function fix(id: OwaspControlId, path: string, line: number, what: string, why: string): OwaspSuggestedFix {
  return { what, where: `${path}:${line}`, why, owaspId: id };
}

function placeholder(line: string): boolean {
  return /\b(example|changeme|placeholder|redacted|dummy|sample|fake|your[-_ ]?(key|token|secret))\b/i.test(line);
}

/** Controls that have a deterministic rule. The others are Grok's judgement only. */
export const STATIC_COVERED_CONTROL_IDS = ["A02", "A03", "A08", "A10", "X01", "X05"] as const;

export function staticCheckCovers(id: OwaspControlId): boolean {
  return (STATIC_COVERED_CONTROL_IDS as readonly string[]).includes(id);
}

const A03_SINK = /\beval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|\b(?:exec|execSync|spawn)\s*\(/;

function withoutQuotedText(line: string): string {
  return line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** A regex literal that names a sink. A real call outside the regex still counts. */
export function isDetectorPatternLine(line: string): boolean {
  if (!/\/(?:\\.|[^/\n])+\/[gimsuy]*/.test(line)) return false;
  const outside = line.replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, " ");
  if (A03_SINK.test(outside)) return false;
  return /eval|Function|innerHTML|\bexec\b|\bspawn\b|SELECT|child_process/.test(line);
}

/** The sink text sits in a quote, as in a test that stores "eval(input)". A real call does not. */
export function isQuotedSinkFixture(line: string): boolean {
  if (!A03_SINK.test(line)) return false;
  return !A03_SINK.test(withoutQuotedText(line));
}

export function isTestFixturePath(path: string): boolean {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

const LIVE_SECRET_VALUE = /^(?:sk-|ghp_|github_pat_|AKIA|xox[baprs]-|xai-)|-----BEGIN /;

function isWordFixture(value: string): boolean {
  return placeholder(value) || /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(value);
}

/** A quoted test value made of words, such as shared-xai-value. Live secret shapes are not this. */
export function isObviousFixtureSecret(line: string): boolean {
  if (/AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-|-----BEGIN /.test(line)) {
    return false;
  }
  if (placeholder(line)) return true;
  const assigned = [
    ...line.matchAll(
      /(?:api[_-]?key|secret|passwd|password|access[_-]?token|private[_-]?key)\s*[:=]\s*['"]([^'"]+)['"]/gi,
    ),
  ].map((match) => match[1] ?? "");
  if (assigned.length > 0) return assigned.every((value) => isWordFixture(value));
  const quoted = [...line.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1] ?? "");
  if (quoted.length === 0) return false;
  return quoted.every((value) => !LIVE_SECRET_VALUE.test(value) && isWordFixture(value));
}

/**
 * Detector regex lines and placeholder values in test fixtures are not findings.
 * A live secret shape in a test file still is.
 */
export function isSuppressedReviewFinding(id: string, path: string, evidence: string, lineText = ""): boolean {
  if (id === "A03") {
    const detector = isDetectorPatternLine(evidence) || isDetectorPatternLine(lineText);
    const quoted =
      isTestFixturePath(path) && (isQuotedSinkFixture(evidence) || isQuotedSinkFixture(lineText));
    return detector || quoted;
  }
  if (id === "X01" && isTestFixturePath(path)) {
    return isObviousFixtureSecret(evidence) || isObviousFixtureSecret(lineText);
  }
  return false;
}

function looksLikeSecret(line: string, path = ""): boolean {
  if (/process\.env|import\.meta\.env|os\.environ|getenv\s*\(/.test(line)) return false;
  if (placeholder(line)) return false;
  if (path && isTestFixturePath(path) && isObviousFixtureSecret(line)) return false;
  if (/AKIA[0-9A-Z]{16}/.test(line)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) return true;
  if (/ghp_[A-Za-z0-9]{20,}/.test(line)) return true;
  if (/github_pat_[A-Za-z0-9_]{20,}/.test(line)) return true;
  if (/xox[baprs]-[A-Za-z0-9-]{10,}/.test(line)) return true;
  if (/sk-[A-Za-z0-9]{16,}/.test(line)) return true;
  const assigned = line.match(
    /(?:api[_-]?key|secret|passwd|password|access[_-]?token|private[_-]?key)\s*[:=]\s*['"]([^'"]+)['"]/i,
  );
  const value = assigned?.[1] ?? "";
  if (value.length < 12) return false;
  if (/^[*x.\-]+$/i.test(value)) return false;
  if (/\$\{/.test(value)) return false;
  return true;
}

type Rule = {
  id: OwaspControlId;
  severity: OwaspSeverity;
  test: (line: string) => boolean;
  what: string;
  why: string;
};

const RULES: readonly Rule[] = [
  {
    id: "X01",
    severity: "high",
    test: (line) => looksLikeSecret(line),
    what: "Remove the hard-coded credential and read it from the environment or a secret store.",
    why: "A credential in source can be copied from repository history.",
  },
  {
    id: "A03",
    severity: "high",
    test: (line) => /\beval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line),
    what: "Stop evaluating or rendering raw input. Parse with an allowlist, or escape output into HTML.",
    why: "eval, Function, or raw HTML sinks let request data run or change the page.",
  },
  {
    id: "A03",
    severity: "high",
    test: (line) =>
      /\b(?:exec|execSync|spawn)\s*\(/.test(line) &&
      /req\.|request\.|`[^`]*\$\{/.test(line),
    what: "Run a fixed command with an argument array and keep request data out of the shell string.",
    why: "A shell string built from request data is command injection.",
  },
  {
    id: "A10",
    severity: "high",
    test: (line) => {
      if (!/\b(?:fetch|axios(?:\.\w+)?|got|https?\.request)\s*\(/.test(line)) return false;
      if (/^[^'"`]*['"`]https?:\/\//.test(line) && !line.includes("${")) return false;
      return /req\.|request\.|params|query|\$\{/.test(line);
    },
    what: "Call the outbound request with an allowlisted URL. Reject caller-supplied hosts.",
    why: "A URL taken from the request can reach internal services.",
  },
  {
    id: "X05",
    severity: "high",
    test: (line) =>
      /path\.(?:join|resolve)\s*\(/.test(line) &&
      /\b(req|request|params|query|input|fileName|filename)\b/.test(line),
    what: "Resolve the path under a fixed directory and reject values that escape it.",
    why: "Joining user input onto a filesystem path allows path traversal.",
  },
  {
    id: "A08",
    severity: "high",
    test: (line) =>
      /\bpickle\.loads\s*\(/.test(line) ||
      /\bunserialize\s*\(/.test(line) ||
      (/\byaml\.load\s*\(/.test(line) && !/safeLoad|FAILSAFE_SCHEMA|JSON_SCHEMA/.test(line)),
    what: "Use a safe loader that rejects unexpected types.",
    why: "Insecure deserialization can run attacker-controlled objects.",
  },
  {
    id: "A02",
    severity: "medium",
    test: (line) =>
      /createHash\(\s*['"](?:md5|sha1)['"]\s*\)/.test(line) &&
      /\b(password|secret|token|session)\b/i.test(line),
    what: "Hash passwords with a password hashing function (bcrypt, scrypt, or argon2), not MD5 or SHA-1.",
    why: "MD5 and SHA-1 are not password hashes.",
  },
];

/** Static FAILs for added lines. One finding per control per line. */
export function runStaticChecks(files: readonly DiffFile[], selected: ReadonlySet<OwaspControlId>): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const line of addedLines(file)) {
      for (const rule of RULES) {
        if (!selected.has(rule.id)) continue;
        if (rule.id === "A03" && (isDetectorPatternLine(line.text) || (isTestFixturePath(line.path) && isQuotedSinkFixture(line.text)))) {
          continue;
        }
        if (rule.id === "X01" && isTestFixturePath(line.path) && isObviousFixtureSecret(line.text)) continue;
        if (!rule.test(line.text)) continue;
        const key = `${rule.id}:${line.path}:${line.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          id: rule.id,
          path: line.path,
          line: line.line,
          evidence: line.text.trim(),
          severity: rule.severity,
          autoFixable: true,
          suggestedFix: fix(rule.id, line.path, line.line, rule.what, rule.why),
        });
      }
    }
  }
  return findings;
}
