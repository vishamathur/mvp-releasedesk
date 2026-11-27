import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_COMMENT_HEADER,
  acceptanceSection,
  collectCriteria,
  evaluateAcceptance,
  parseCoverageSummary,
  parseCriterionIds,
  parseJestJson,
  renderAcceptanceComment,
  type TestRun,
} from "./index.js";

const run = (tests: TestRun["tests"], fileFailures: string[] = []): TestRun => ({ tests, fileFailures });
const t = (name: string, status: "passed" | "failed" | "skipped" = "passed") => ({ name, file: "a.test.ts", status });

describe("criterion ids", () => {
  it("finds AC and REG ids in order without duplicates", () => {
    expect(parseCriterionIds("- [ ] AC-1: Given\n- [ ] AC-2 When\nAC-1 again\nAC-3.1 and REG-N10")).toEqual([
      "AC-1",
      "AC-2",
      "AC-3.1",
      "REG-N10",
    ]);
  });

  it("does not treat AC-12 as AC-1 or match lowercase ids", () => {
    expect(parseCriterionIds("AC-12 ac-3 XAC-4")).toEqual(["AC-12"]);
  });

  it("reads only the Acceptance criteria section of the PR body, without HTML comments", () => {
    const body = "## What\nAC-9\n## Acceptance criteria\n<!-- AC-7 example -->\n- [x] AC-1 Given a user\n### Notes\n- AC-2\n## Test evidence\nAC-8";
    expect(parseCriterionIds(acceptanceSection(body))).toEqual(["AC-1", "AC-2"]);
    expect(acceptanceSection(null)).toBe("");
  });

  it("merges the PR body with changed acceptance files", () => {
    expect(collectCriteria("## Acceptance criteria\nAC-1", ["# Story\nAC-1\nAC-2\nREG-N10"])).toEqual(["AC-1", "AC-2", "REG-N10"]);
  });
});

describe("report parsing", () => {
  it("parses Jest-format results and flags files that failed outside a test", () => {
    const raw = JSON.stringify({
      testResults: [
        {
          name: "/app/a.test.ts",
          status: "passed",
          assertionResults: [
            { fullName: "login AC-1 locks after 5 tries", title: "x", status: "passed" },
            { ancestorTitles: ["login"], title: "AC-2 todo", status: "todo" },
          ],
        },
        { name: "/app/broken.test.ts", status: "failed", assertionResults: [] },
      ],
    });
    const parsed = parseJestJson(raw);
    expect(parsed.tests).toEqual([
      { name: "login AC-1 locks after 5 tries", file: "/app/a.test.ts", status: "passed" },
      { name: "login AC-2 todo", file: "/app/a.test.ts", status: "skipped" },
    ]);
    expect(parsed.fileFailures).toEqual(["/app/broken.test.ts"]);
  });

  it("rejects reports in the wrong shape", () => {
    expect(() => parseJestJson("nope")).toThrow(/not valid JSON/);
    expect(() => parseJestJson("{}")).toThrow(/testResults/);
    expect(parseCoverageSummary(JSON.stringify({ total: { lines: { pct: 87.5 } } }))).toBe(87.5);
    expect(() => parseCoverageSummary("{}")).toThrow(/total.lines.pct/);
  });
});

describe("evaluateAcceptance", () => {
  const base = { testExitCode: 0, linesPct: 90, coverageThreshold: 80, exempt: false };

  it("passes when every criterion has a passing named test and coverage is met", () => {
    const report = evaluateAcceptance({
      ...base,
      criteria: ["AC-1", "AC-2", "REG-N10"],
      run: run([t("AC-1 shows the form"), t("form AC-2: rejects bad id"), t("REG-N10 lockout resets"), t("other")]),
    });
    expect(report.status).toBe("passed");
    expect(report.criteria.map((c) => c.status)).toEqual(["passed", "passed", "passed"]);
    expect(report.reasons).toEqual([]);
  });

  it("fails on a missing, skipped-only or failing criterion test", () => {
    const report = evaluateAcceptance({
      ...base,
      criteria: ["AC-1", "AC-2", "AC-3"],
      run: run([t("AC-1 ok"), t("AC-2 later", "skipped"), t("AC-3 a"), t("AC-3 b", "failed")]),
    });
    expect(report.status).toBe("failed");
    expect(report.criteria.map((c) => c.status)).toEqual(["passed", "missing", "failed"]);
    expect(report.reasons.join("\n")).toMatch(/no passing named test for AC-2/);
    expect(report.reasons.join("\n")).toMatch(/failing test for AC-3/);
  });

  it("fails on any failing test in the full suite (regression), even without a criterion id", () => {
    const report = evaluateAcceptance({
      ...base,
      criteria: ["AC-1"],
      run: run([t("AC-1 ok"), t("old lockout behaviour", "failed")], ["/app/x.test.ts"]),
    });
    expect(report.status).toBe("failed");
    expect(report.failingTests).toEqual(["old lockout behaviour", "/app/x.test.ts (file failed to run)"]);
  });

  it("fails when coverage is below the threshold or missing, and skips it at 0", () => {
    const criteria = ["AC-1"];
    const r = run([t("AC-1 ok")]);
    expect(evaluateAcceptance({ ...base, criteria, run: r, linesPct: 79.9 }).reasons).toEqual([
      "line coverage 79.9% is below 80%",
    ]);
    expect(evaluateAcceptance({ ...base, criteria, run: r, linesPct: null }).reasons).toEqual([
      "no coverage summary was produced",
    ]);
    expect(evaluateAcceptance({ ...base, criteria, run: r, linesPct: null, coverageThreshold: 0 }).status).toBe("passed");
  });

  it("fails with no criteria unless the PR is exempt, and on no results or a failed command", () => {
    expect(evaluateAcceptance({ ...base, criteria: [], run: run([t("x")]) }).status).toBe("failed");
    expect(evaluateAcceptance({ ...base, criteria: [], run: run([t("x")]), exempt: true }).status).toBe("passed");
    expect(evaluateAcceptance({ ...base, criteria: ["AC-1"], run: null }).reasons).toContain("no test results were produced");
    expect(evaluateAcceptance({ ...base, criteria: ["AC-1"], run: run([t("AC-1")]), testExitCode: 2 }).reasons).toEqual([
      "test command exited with code 2",
    ]);
  });

  it("renders a short matrix", () => {
    const text = renderAcceptanceComment(
      evaluateAcceptance({ ...base, criteria: ["AC-1", "AC-2"], run: run([t("AC-1 a | b")]) }),
    );
    expect(text.startsWith(ACCEPTANCE_COMMENT_HEADER)).toBe(true);
    expect(text).toContain("| AC-1 | pass | AC-1 a \\| b |");
    expect(text).toContain("| AC-2 | MISSING | none |");
    expect(text).toContain("Status: failed.");
  });
});

describe("acceptance-reusable workflow", () => {
  const yaml = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows/acceptance-reusable.yml"),
    "utf8",
  );

  it("is a reusable workflow with a review job, an 80% default and no secrets", () => {
    expect(yaml).toContain("workflow_call:");
    expect(yaml).toMatch(/\n {2}review:\n/);
    expect(yaml).toMatch(/coverage_threshold:[\s\S]*?default: 80/);
    expect(yaml).not.toMatch(/\$\{\{\s*secrets\./);
    expect(yaml).not.toContain("RELEASEDESK_GROK_API_KEY");
    expect(yaml).toContain("scripts/acceptance-check.ts");
  });
});
