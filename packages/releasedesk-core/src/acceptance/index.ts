/**
 * Acceptance check for customer repos (QA as a Builder capability).
 *
 * Every Given / When / Then acceptance criterion has an id (`AC-1`, `AC-2`, `AC-3.1`).
 * A reviewer-found regression has an id too (`REG-N10`). Each id needs at least one
 * named test whose full name contains the id, and that test must pass.
 *
 * The check fails when a criterion has no test, a criterion test fails, any test in the
 * full suite fails (regression), the test command fails, or line coverage is below the
 * threshold. This module is pure: parsing and evaluation. The CLI
 * `scripts/acceptance-check.ts` reads the files and the pull request event.
 */

export const ACCEPTANCE_COMMENT_HEADER = "## acceptance v1";
export const DEFAULT_COVERAGE_THRESHOLD = 80;
export const DEFAULT_CRITERIA_DIR = "docs/acceptance";
export const DEFAULT_EXEMPT_LABELS = ["dependencies"];

/** `AC-<n>` or `AC-<n>.<m>` for criteria; `REG-<finding>` for regression tests. */
const ID_PATTERN = /(?<![A-Za-z0-9.-])((?:AC-\d+(?:\.\d+)?)|(?:REG-[A-Z0-9]+(?:-[A-Z0-9]+)*))(?![A-Za-z0-9.])/g;

export type TestStatus = "passed" | "failed" | "skipped";

export interface TestCase {
  name: string;
  file: string;
  status: TestStatus;
}

export interface TestRun {
  tests: TestCase[];
  /** Test files that failed outside a test case (for example an import error). */
  fileFailures: string[];
}

export type CriterionStatus = "passed" | "failed" | "missing";

export interface CriterionResult {
  id: string;
  status: CriterionStatus;
  tests: string[];
}

export interface AcceptanceInput {
  criteria: string[];
  run: TestRun | null;
  testExitCode: number;
  /** Total line coverage percent, or null when no coverage summary was produced. */
  linesPct: number | null;
  /** 0 turns the coverage check off. */
  coverageThreshold: number;
  /** True when the pull request carries an exempt label (no criteria required). */
  exempt: boolean;
}

export interface AcceptanceReport {
  status: "passed" | "failed";
  criteria: CriterionResult[];
  failingTests: string[];
  totals: { passed: number; failed: number; skipped: number };
  coverage: { linesPct: number | null; threshold: number; met: boolean };
  testExitCode: number;
  exempt: boolean;
  reasons: string[];
}

export class AcceptanceError extends Error {}

/** Ordered, de-duplicated criterion and regression ids found in the text. */
export function parseCriterionIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(ID_PATTERN)) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The body of the `## Acceptance criteria` section of a pull request body, or "". */
export function acceptanceSection(prBody: string | null | undefined): string {
  if (!prBody) return "";
  const lines = prBody.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+acceptance criteria\b/i.test(l.trim()));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2}\s/.test(l.trim()));
  const section = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  return section.replace(/<!--[\s\S]*?-->/g, "");
}

/** Criteria from the PR body section plus every acceptance file the PR adds or changes. */
export function collectCriteria(prBody: string | null | undefined, criteriaFiles: string[]): string[] {
  return parseCriterionIds([acceptanceSection(prBody), ...criteriaFiles].join("\n"));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normaliseStatus(status: unknown): TestStatus {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "skipped";
}

/**
 * Parse a Jest-format JSON report (`vitest --reporter=json` and `jest --json` both write it).
 */
export function parseJestJson(raw: string): TestRun {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AcceptanceError("test results are not valid JSON");
  }
  const root = asRecord(data);
  const files = root && Array.isArray(root.testResults) ? root.testResults : null;
  if (!files) throw new AcceptanceError("test results have no testResults array (expected Jest-format JSON)");
  const tests: TestCase[] = [];
  const fileFailures: string[] = [];
  for (const entry of files) {
    const file = asRecord(entry);
    if (!file) continue;
    const fileName = typeof file.name === "string" ? file.name : "unknown file";
    const cases = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    for (const c of cases) {
      const tc = asRecord(c);
      if (!tc) continue;
      const title = typeof tc.title === "string" ? tc.title : "";
      const ancestors = Array.isArray(tc.ancestorTitles) ? tc.ancestorTitles.filter((t) => typeof t === "string") : [];
      const name = typeof tc.fullName === "string" && tc.fullName ? tc.fullName : [...ancestors, title].join(" ");
      tests.push({ name, file: fileName, status: normaliseStatus(tc.status) });
    }
    if (file.status === "failed" && !cases.some((c) => asRecord(c)?.status === "failed")) {
      fileFailures.push(fileName);
    }
  }
  return { tests, fileFailures };
}

/** Total line coverage from an Istanbul `coverage-summary.json` (json-summary reporter). */
export function parseCoverageSummary(raw: string): number {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AcceptanceError("coverage summary is not valid JSON");
  }
  const pct = asRecord(asRecord(asRecord(data)?.total)?.lines)?.pct;
  if (typeof pct !== "number" || Number.isNaN(pct)) {
    throw new AcceptanceError("coverage summary has no total.lines.pct");
  }
  return pct;
}

function idPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9.-])${escaped}(?![A-Za-z0-9.])`);
}

export function evaluateAcceptance(input: AcceptanceInput): AcceptanceReport {
  const reasons: string[] = [];
  const tests = input.run?.tests ?? [];
  const criteria: CriterionResult[] = input.criteria.map((id) => {
    const re = idPattern(id);
    const matched = tests.filter((t) => re.test(t.name));
    const ran = matched.filter((t) => t.status !== "skipped");
    let status: CriterionStatus = "missing";
    if (ran.some((t) => t.status === "failed")) status = "failed";
    else if (ran.length > 0) status = "passed";
    return { id, status, tests: matched.map((t) => t.name) };
  });

  if (!input.run) reasons.push("no test results were produced");
  if (input.criteria.length === 0 && !input.exempt) {
    reasons.push("no acceptance criteria ids (AC-1, AC-2, ...) in the PR body or a changed acceptance file");
  }
  const missing = criteria.filter((c) => c.status === "missing").map((c) => c.id);
  const failed = criteria.filter((c) => c.status === "failed").map((c) => c.id);
  if (missing.length) reasons.push(`no passing named test for ${missing.join(", ")}`);
  if (failed.length) reasons.push(`failing test for ${failed.join(", ")}`);

  const failingTests = [
    ...tests.filter((t) => t.status === "failed").map((t) => t.name),
    ...(input.run?.fileFailures ?? []).map((f) => `${f} (file failed to run)`),
  ];
  if (failingTests.length) reasons.push(`${failingTests.length} failing test(s) in the full suite`);
  if (input.testExitCode !== 0 && failingTests.length === 0) {
    reasons.push(`test command exited with code ${input.testExitCode}`);
  }

  const threshold = input.coverageThreshold;
  let met = true;
  if (threshold > 0) {
    if (input.linesPct === null) {
      met = false;
      reasons.push("no coverage summary was produced");
    } else if (input.linesPct < threshold) {
      met = false;
      reasons.push(`line coverage ${input.linesPct}% is below ${threshold}%`);
    }
  }

  return {
    status: reasons.length === 0 ? "passed" : "failed",
    criteria,
    failingTests,
    totals: {
      passed: tests.filter((t) => t.status === "passed").length,
      failed: tests.filter((t) => t.status === "failed").length,
      skipped: tests.filter((t) => t.status === "skipped").length,
    },
    coverage: { linesPct: input.linesPct, threshold, met },
    testExitCode: input.testExitCode,
    exempt: input.exempt,
    reasons,
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 160);
}

const STATUS_MARK: Record<CriterionStatus, string> = { passed: "pass", failed: "FAIL", missing: "MISSING" };

/** Short Markdown report for the job summary and the PR comment. */
export function renderAcceptanceComment(report: AcceptanceReport): string {
  const lines: string[] = [ACCEPTANCE_COMMENT_HEADER, ""];
  const pct = report.coverage.linesPct === null ? "n/a" : `${report.coverage.linesPct}%`;
  const limit = report.coverage.threshold > 0 ? `threshold ${report.coverage.threshold}%` : "threshold off";
  const coverage = `${pct} lines (${limit})`;
  lines.push(
    `Status: ${report.status}. Tests: ${report.totals.passed} passed, ${report.totals.failed} failed, ${report.totals.skipped} skipped. Coverage: ${coverage}.`,
  );
  if (report.exempt && report.criteria.length === 0) lines.push("", "Exempt label: no acceptance criteria required.");
  if (report.criteria.length) {
    lines.push("", "| Criterion | Result | Tests |", "| --- | --- | --- |");
    for (const c of report.criteria) {
      const names = c.tests.length ? c.tests.slice(0, 3).map(cell).join("<br>") : "none";
      lines.push(`| ${c.id} | ${STATUS_MARK[c.status]} | ${names}${c.tests.length > 3 ? ` (+${c.tests.length - 3})` : ""} |`);
    }
  }
  if (report.failingTests.length) {
    lines.push("", "Failing tests (possible regressions):");
    for (const t of report.failingTests.slice(0, 10)) lines.push(`- ${cell(t)}`);
    if (report.failingTests.length > 10) lines.push(`- ... and ${report.failingTests.length - 10} more`);
  }
  if (report.reasons.length) {
    lines.push("", "Why it failed:");
    for (const r of report.reasons) lines.push(`- ${r}`);
  }
  lines.push("", "Every criterion needs a passing test with its id in the test name. A reviewer-found regression needs a `REG-<finding>` test.");
  return lines.join("\n");
}
