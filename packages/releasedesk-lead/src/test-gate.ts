import { formatMockNote, nowIso, type TaskRecord } from "@releasedesk/core";
import { latestTasksByRole } from "./readiness.js";
import type { PullRequestRecord } from "./pr/types.js";

/**
 * Automated testing gate — continuous-feedback checkpoint before human merge/release.
 * Aggregates Builder Cloud Agent tests, optional workspace suite (MOCK by default),
 * and tracked PR check status. Failures block readiness.
 */

export type TestGateCheckStatus = "passed" | "failed" | "skipped";

export type TestGateCheck = {
  id: string;
  name: string;
  status: TestGateCheckStatus;
  source: "builder" | "workspace_suite" | "pr_checks";
  detail: string;
  mocked?: boolean;
};

export type TestGateResult = {
  id: string;
  status: "passed" | "failed";
  evaluatedAt: string;
  summary: string;
  checks: TestGateCheck[];
  blocking: boolean;
};

export type TestGateRecord = {
  gates: TestGateResult[];
};

export type WorkspaceSuiteResult = {
  status: "passed" | "failed";
  summary: string;
  mocked: boolean;
};

/** Pluggable workspace suite runner — MOCK by default (no real CI invocation). */
export type WorkspaceSuiteRunner = (input: {
  repository: string;
  baseRef?: string;
  headRef?: string;
}) => Promise<WorkspaceSuiteResult> | WorkspaceSuiteResult;

export function createMockWorkspaceSuiteRunner(
  override?: Partial<WorkspaceSuiteResult>,
): WorkspaceSuiteRunner {
  return () => ({
    status: override?.status ?? "passed",
    summary:
      override?.summary ??
      formatMockNote("Workspace suite (unit/typecheck) assumed green — MOCK local runner"),
    mocked: override?.mocked ?? true,
  });
}

let testGateSeq = 0;

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseTestGateRecord(raw: unknown): TestGateRecord {
  if (!raw || typeof raw !== "object") return { gates: [] };
  const gates = (raw as { gates?: TestGateResult[] }).gates;
  return { gates: Array.isArray(gates) ? gates : [] };
}

export function latestTestGate(record: TestGateRecord | undefined): TestGateResult | undefined {
  const gates = record?.gates ?? [];
  return gates[gates.length - 1];
}

export async function evaluateTestGate(input: {
  tasks: readonly TaskRecord[];
  pullRequests?: PullRequestRecord;
  repository: string;
  baseRef?: string;
  headRef?: string;
  workspaceSuite?: WorkspaceSuiteRunner;
}): Promise<TestGateResult> {
  testGateSeq += 1;
  const checks: TestGateCheck[] = [];
  const suiteRunner = input.workspaceSuite ?? createMockWorkspaceSuiteRunner();
  const suite = await suiteRunner({
    repository: input.repository,
    baseRef: input.baseRef,
    headRef: input.headRef,
  });

  checks.push({
    id: "workspace_suite",
    name: "Workspace suite",
    status: suite.status === "passed" ? "passed" : "failed",
    source: "workspace_suite",
    detail: suite.summary,
    mocked: suite.mocked,
  });

  const latest = latestTasksByRole(input.tasks);
  const builder = latest.find((t) => t.agentRole === "builder");
  if (!builder) {
    checks.push({
      id: "builder_tests",
      name: "Builder / Cloud Agent tests",
      status: "skipped",
      source: "builder",
      detail: "No builder remediation wave in this run — Cloud Agent tests not applicable",
    });
  } else if (builder.status !== "completed") {
    checks.push({
      id: "builder_tests",
      name: "Builder / Cloud Agent tests",
      status: "failed",
      source: "builder",
      detail: `Builder task ended as ${builder.status}`,
    });
  } else {
    const testsPassed = asBoolean(builder.output?.testsPassed);
    if (testsPassed === false) {
      checks.push({
        id: "builder_tests",
        name: "Builder / Cloud Agent tests",
        status: "failed",
        source: "builder",
        detail: "Cloud Agent testing reported testsPassed=false",
      });
    } else if (testsPassed === true) {
      checks.push({
        id: "builder_tests",
        name: "Builder / Cloud Agent tests",
        status: "passed",
        source: "builder",
        detail: "Cloud Agent testing reported testsPassed=true",
      });
    } else {
      checks.push({
        id: "builder_tests",
        name: "Builder / Cloud Agent tests",
        status: "failed",
        source: "builder",
        detail: "Builder completed without testsPassed evidence",
      });
    }
  }

  const prs = input.pullRequests?.pullRequests ?? [];
  if (prs.length === 0) {
    checks.push({
      id: "pr_checks",
      name: "Tracked PR checks",
      status: "skipped",
      source: "pr_checks",
      detail: "No tracked pull requests — PR CI status not evaluated",
    });
  } else {
    let anyFailed = false;
    const details: string[] = [];
    for (const pr of prs) {
      const checkStatus = pr.lastStatus?.checkStatus;
      if (checkStatus === "failure" || checkStatus === "error") {
        anyFailed = true;
        details.push(`PR #${pr.prNumber} checks=${checkStatus}`);
      } else if (checkStatus === "pending") {
        details.push(`PR #${pr.prNumber} checks still ${checkStatus}`);
      } else {
        details.push(`PR #${pr.prNumber} checks=${checkStatus ?? "unknown"}`);
      }
    }
    checks.push({
      id: "pr_checks",
      name: "Tracked PR checks",
      status: anyFailed ? "failed" : "passed",
      source: "pr_checks",
      detail: details.join("; "),
      mocked: prs.every((p) => p.clientMode === "mock"),
    });
  }

  const failed = checks.filter((c) => c.status === "failed");
  const status: TestGateResult["status"] = failed.length === 0 ? "passed" : "failed";
  const summary =
    status === "passed"
      ? `Test gate passed (${checks.filter((c) => c.status === "passed").length} check(s) green)`
      : `Test gate failed: ${failed.map((c) => c.detail).join("; ")}`;

  return {
    id: `test_gate_${testGateSeq}_${Date.now()}`,
    status,
    evaluatedAt: nowIso(),
    summary,
    checks,
    blocking: status === "failed",
  };
}
