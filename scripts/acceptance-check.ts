#!/usr/bin/env npx tsx
/**
 * Acceptance check for a customer repo pull request.
 *
 * Reads the Jest-format test results, the Istanbul coverage summary, the acceptance files the
 * pull request changes and the PR body (`## Acceptance criteria`), then prints the
 * acceptance v1 Markdown report. Exit 1 when the check fails.
 *
 * Environment (all set by .github/workflows/acceptance-reusable.yml):
 *   APP_DIR                 caller repo checkout (default ".")
 *   RESULTS_PATH            Jest-format JSON, relative to APP_DIR
 *   COVERAGE_SUMMARY_PATH   coverage-summary.json, relative to APP_DIR
 *   COVERAGE_THRESHOLD      line coverage percent, 0 turns it off (default 80)
 *   CHANGED_CRITERIA_FILES  newline-separated acceptance files changed by the PR, relative to APP_DIR
 *   TEST_EXIT_CODE          exit code of the test command
 *   EXEMPT_LABELS           comma-separated labels that need no criteria (default "dependencies")
 *   PR_LABELS               comma-separated labels on the PR
 *   GITHUB_EVENT_PATH       pull request event payload (for the PR body)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AcceptanceError,
  DEFAULT_COVERAGE_THRESHOLD,
  DEFAULT_EXEMPT_LABELS,
  collectCriteria,
  evaluateAcceptance,
  parseCoverageSummary,
  parseJestJson,
  renderAcceptanceComment,
  type AcceptanceReport,
  type TestRun,
} from "../packages/releasedesk-core/src/acceptance/index.ts";

function list(value: string | undefined, sep: string | RegExp): string[] {
  return (value ?? "").split(sep).map((s) => s.trim()).filter(Boolean);
}

function readPrBody(): string {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) return "";
  const event = JSON.parse(readFileSync(path, "utf8")) as { pull_request?: { body?: string | null } };
  return event.pull_request?.body ?? "";
}

export function runAcceptanceCheck(env: NodeJS.ProcessEnv = process.env): AcceptanceReport {
  const appDir = resolve(env.APP_DIR ?? ".");
  const notes: string[] = [];

  let run: TestRun | null = null;
  const resultsPath = resolve(appDir, env.RESULTS_PATH ?? "reports/acceptance-results.json");
  if (existsSync(resultsPath)) {
    try {
      run = parseJestJson(readFileSync(resultsPath, "utf8"));
    } catch (err) {
      notes.push(err instanceof AcceptanceError ? err.message : "test results could not be read");
    }
  }

  let linesPct: number | null = null;
  const coveragePath = resolve(appDir, env.COVERAGE_SUMMARY_PATH ?? "coverage/coverage-summary.json");
  if (existsSync(coveragePath)) {
    try {
      linesPct = parseCoverageSummary(readFileSync(coveragePath, "utf8"));
    } catch (err) {
      notes.push(err instanceof AcceptanceError ? err.message : "coverage summary could not be read");
    }
  }

  const criteriaFiles = list(env.CHANGED_CRITERIA_FILES, /\r?\n/)
    .map((f) => resolve(appDir, f))
    .filter((f) => f.startsWith(appDir + sep) && existsSync(f))
    .map((f) => readFileSync(f, "utf8"));

  const threshold = env.COVERAGE_THRESHOLD === undefined || env.COVERAGE_THRESHOLD === ""
    ? DEFAULT_COVERAGE_THRESHOLD
    : Number(env.COVERAGE_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new AcceptanceError("COVERAGE_THRESHOLD must be a number from 0 to 100");
  }
  const exemptLabels = env.EXEMPT_LABELS === undefined ? DEFAULT_EXEMPT_LABELS : list(env.EXEMPT_LABELS, ",");
  const prLabels = list(env.PR_LABELS, ",");
  const exitCode = Number(env.TEST_EXIT_CODE ?? "0");

  const report = evaluateAcceptance({
    criteria: collectCriteria(readPrBody(), criteriaFiles),
    run,
    testExitCode: Number.isInteger(exitCode) ? exitCode : 1,
    linesPct,
    coverageThreshold: threshold,
    exempt: prLabels.some((l) => exemptLabels.includes(l)),
  });
  if (notes.length) {
    report.reasons.unshift(...notes);
    report.status = "failed";
  }
  return report;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry as string).href;
}

if (isDirectRun()) {
  try {
    const report = runAcceptanceCheck();
    process.stdout.write(`${renderAcceptanceComment(report)}\n`);
    if (report.status === "failed") process.exitCode = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : "acceptance check failed";
    process.stdout.write(`## acceptance v1\n\nStatus: failed. ${message.slice(0, 300)}\n`);
    process.exitCode = 1;
  }
}
