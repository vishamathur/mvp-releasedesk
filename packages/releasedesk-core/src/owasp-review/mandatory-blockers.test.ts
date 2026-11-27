import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GrokTelemetry } from "../grok-telemetry.js";
import { parseOwaspReviewComment, renderOwaspReviewComment } from "./comment.js";
import { addedPatch } from "./diff.js";
import {
  classifyMandatory,
  extractCwes,
  mandatoryWording,
  MANDATORY_CWES,
  owaspCheckExitCode,
} from "./mandatory-blockers.js";
import { OWASP_REVIEW_KEY_ENV_LEAD, owaspModelJsonSchema, reviewDiff, type ModelCallResult } from "./review.js";
import { selectControls } from "./select.js";
import type { DiffFile, OwaspSeverity } from "./types.js";

const TELEMETRY: GrokTelemetry = {
  requestedModel: "grok-4.3",
  servedModel: "grok-4.3",
  promptTokens: 1,
  completionTokens: 1,
  reasoningTokens: null,
  totalTokens: 2,
  cachedPromptTokens: null,
  costInUsdTicks: null,
  latencyMs: 1,
  estUsd: 0,
  estNote: "estimate, not a bill",
  billedCostUsd: null,
  billedNote: "billed cost not reported",
};

// Security's wording for the lockout finding on the Northwind KYC change (REQ-2026-0001, N20).
const N20_TEXT =
  "Lockout is cosmetic; failed guesses are not throttled. Online guessing of the configured analyst and intake tokens is unthrottled because the lock never short-circuits the credential check.";

function classify(over: Partial<Parameters<typeof classifyMandatory>[0]> = {}) {
  return classifyMandatory({
    id: "A05",
    severity: "low",
    path: "src/lib/thing.ts",
    evidence: "const a = 1;",
    ...over,
  });
}

describe("classifyMandatory", () => {
  it("does not block a low or medium finding outside the categories", () => {
    for (const severity of ["low", "medium"] as OwaspSeverity[]) {
      expect(classify({ severity, id: "A05", evidence: "app.use(cors());" }).mandatory).toBe(false);
      expect(classify({ severity, id: "A09", evidence: "console.log(user);" }).mandatory).toBe(false);
    }
  });

  it("blocks every finding the model grades high or critical", () => {
    for (const severity of ["high", "critical"] as OwaspSeverity[]) {
      const verdict = classify({ severity, id: "A05" });
      expect(verdict.mandatory).toBe(true);
      expect(verdict.reasons).toContain(`severity ${severity}`);
    }
  });

  it("blocks a low-severity A07 failure", () => {
    const verdict = classify({ id: "A07", severity: "low" });
    expect(verdict.mandatory).toBe(true);
    expect(verdict.reasons).toContain("control A07");
  });

  it("blocks A01 and X06 access control failures at any severity", () => {
    expect(classify({ id: "A01", severity: "medium" }).mandatory).toBe(true);
    expect(classify({ id: "X06", severity: "low" }).mandatory).toBe(true);
  });

  it("blocks a hard-coded secret in production code but not in a test fixture", () => {
    expect(classify({ id: "X01", path: "src/lib/config.ts" }).mandatory).toBe(true);
    expect(classify({ id: "X01", path: "src/lib/config.test.ts" }).mandatory).toBe(false);
    expect(classify({ id: "X01", path: "tests/fixtures/users.ts" }).mandatory).toBe(false);
    expect(classify({ id: "A05", path: "src/lib/config.ts", cwe: "CWE-798" }).mandatory).toBe(true);
    expect(classify({ id: "A05", path: "src/lib/config.test.ts", cwe: "CWE-798" }).mandatory).toBe(false);
  });

  it("blocks by CWE id whatever the control id and severity", () => {
    for (const cwe of [307, 287, 284, 639, 798, 521, 613]) {
      expect(cwe in MANDATORY_CWES).toBe(true);
      const verdict = classify({ id: "A04", severity: "low", cwe: `CWE-${cwe}` });
      expect(verdict.mandatory).toBe(true);
      expect(verdict.cwes).toEqual([`CWE-${cwe}`]);
    }
    expect(classify({ id: "A04", cwe: "CWE-79" }).mandatory).toBe(false);
  });

  it("reads a CWE id from the finding text when the reviewer left the field empty", () => {
    expect(extractCwes("", "see CWE-307 and cwe 287")).toEqual([287, 307]);
    expect(classify({ id: "A04", evidence: "no limit (CWE-307)" }).mandatory).toBe(true);
  });

  it("blocks authentication wording under any control id and severity", () => {
    const samples = [
      "Attackers can brute force the login form.",
      "This allows credential stuffing against the sign-in route.",
      "A session fixation flaw keeps the old session id after login.",
      "The check allows an authentication bypass through the alternate route.",
      "Five anonymous bad guesses can lock out every applicant.",
      N20_TEXT,
      "The password rate limit is missing on the login route.",
    ];
    for (const text of samples) {
      const verdict = classify({ id: "A04", severity: "medium", evidence: text });
      expect(verdict.mandatory, text).toBe(true);
    }
  });

  it("leaves unrelated wording alone", () => {
    for (const text of [
      "The rate limit on the public search page is high.",
      "Add a Content-Security-Policy header.",
      "The lockfile is out of date.",
      "Token budget for the model call is large.",
    ]) {
      expect(mandatoryWording(text), text).toBeNull();
    }
  });

  it("never lets a low model severity remove a blocker", () => {
    const verdict = classify({ id: "A07", severity: "low", cwe: "CWE-307", evidence: N20_TEXT });
    expect(verdict.mandatory).toBe(true);
    expect(verdict.reasons.length).toBeGreaterThan(1);
  });
});

describe("owaspCheckExitCode", () => {
  it("fails a failed review", () => {
    expect(owaspCheckExitCode({ status: "failed", failures: [] })).toBe(1);
  });
  it("fails when a mandatory blocker is open", () => {
    expect(owaspCheckExitCode({ status: "completed", failures: [{ mandatory: false }, { mandatory: true }] })).toBe(1);
  });
  it("passes when failures are not mandatory, when there are none, and when skipped", () => {
    expect(owaspCheckExitCode({ status: "completed", failures: [{ mandatory: false }] })).toBe(0);
    expect(owaspCheckExitCode({ status: "completed", failures: [] })).toBe(0);
    expect(owaspCheckExitCode({ status: "skipped", failures: [] })).toBe(0);
  });
});

function fileOf(path: string, lines: string[]): DiffFile {
  return { path, patch: addedPatch(lines) };
}

function modelFailing(
  files: DiffFile[],
  target: { id: string; path: string; line: number; evidence: string; severity: OwaspSeverity; cwe?: string; what?: string },
): ModelCallResult {
  const controls = selectControls(files)
    .controls.filter((control) => control.selected)
    .map((control) =>
      control.id === target.id
        ? {
            id: control.id,
            verdict: "FAIL" as const,
            confidence: 0.9,
            path: target.path,
            line: target.line,
            evidence: target.evidence,
            severity: target.severity,
            autoFixable: true,
            cwe: target.cwe ?? "",
            suggestedFix: {
              what: target.what ?? "Change this line so the control is met.",
              where: `${target.path}:${target.line}`,
              why: "The control is not met.",
              owaspId: control.id,
            },
          }
        : {
            id: control.id,
            verdict: "PASS" as const,
            confidence: 0.9,
            path: "",
            line: 0,
            evidence: "",
            severity: "none" as const,
            autoFixable: true,
            cwe: "",
            suggestedFix: { what: "", where: "", why: "", owaspId: control.id },
          },
    );
  return { ok: true, payload: { controls }, requestedModel: "grok-4.3", servedModel: "grok-4.3", telemetry: TELEMETRY };
}

describe("reviewDiff with mandatory blockers", () => {
  const gatePath = "src/lib/gate.ts";
  const gateLine = "  if (await resolveActor(token)) return allow(token);";
  const files = [fileOf(gatePath, [gateLine])];

  function review(severity: OwaspSeverity, id = "A07", cwe = "") {
    return reviewDiff(
      {
        repository: "example/app",
        pullRequest: 1,
        headSha: "abc1234",
        title: "lockout change",
        files,
        generatedAt: "2026-11-27T00:00:00.000Z",
      },
      modelFailing(files, { id, path: gatePath, line: 1, evidence: gateLine, severity, cwe }),
      OWASP_REVIEW_KEY_ENV_LEAD,
    );
  }

  it("counts a medium A07 lockout finding as a mandatory blocker and fails the check", () => {
    const report = review("medium", "A07", "CWE-307");
    expect(report.failures).toHaveLength(1);
    const failure = report.failures[0];
    expect(failure?.severity).toBe("medium");
    expect(failure?.mandatory).toBe(true);
    expect(failure?.cwe).toEqual(["CWE-307"]);
    expect(failure?.mandatoryReasons.join(" ")).toContain("control A07");
    expect(report.mandatoryBlockers).toBe(1);
    expect(report.outcome).toBe("remediate");
    expect(owaspCheckExitCode(report)).toBe(1);
  });

  it("does not fail the check for a medium finding outside the categories", () => {
    const report = review("medium", "X03");
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.id).toBe("X03");
    expect(report.failures[0]?.mandatory).toBe(false);
    expect(report.mandatoryBlockers).toBe(0);
    expect(owaspCheckExitCode(report)).toBe(0);
  });

  it("fails the check for a high finding in any control", () => {
    const report = review("high", "X03");
    expect(report.mandatoryBlockers).toBe(1);
    expect(owaspCheckExitCode(report)).toBe(1);
  });

  it("shows Mandatory blockers apart from other failures and keeps them in the machine block", () => {
    const comment = renderOwaspReviewComment(review("medium", "A07", "CWE-307"));
    expect(comment).toContain("### Mandatory blockers");
    expect(comment).toContain("### Other failures handed to Builder");
    expect(comment).toContain("This check fails: 1 mandatory blocker.");
    expect(comment).toContain("Blocks because: control A07");
    const mandatorySection = comment.split("### Mandatory blockers")[1]?.split("### Other failures")[0] ?? "";
    expect(mandatorySection).toContain("src/lib/gate.ts:1");
    const parsed = parseOwaspReviewComment(comment);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.report.mandatoryBlockers).toBe(1);
      expect(parsed.report.failures[0]?.mandatory).toBe(true);
    }
  });

  it("lists a non-mandatory failure under the other section only", () => {
    const comment = renderOwaspReviewComment(review("low", "X03"));
    expect(comment).not.toContain("This check fails");
    const mandatorySection = comment.split("### Mandatory blockers")[1]?.split("### Other failures")[0] ?? "";
    expect(mandatorySection).toContain("_None._");
  });

  it("still reads a comment written before this change", () => {
    const comment = renderOwaspReviewComment(review("low", "X03"));
    const legacy = comment
      .replace(/"mandatoryBlockers": \d+,\n/, "")
      .replace(/\s*"mandatory": (?:true|false),/g, "")
      .replace(/\s*"mandatoryReasons": \[[^\]]*\],/g, "")
      .replace(/,\s*"cwe": \[[^\]]*\]/g, "");
    const parsed = parseOwaspReviewComment(legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.failures[0]?.mandatory).toBe(false);
  });
});

describe("model schema", () => {
  it("asks for a cwe field and requires it", () => {
    const schema = owaspModelJsonSchema(["A07"]) as {
      properties: { controls: { items: { required: string[]; properties: Record<string, unknown> } } };
    };
    expect(schema.properties.controls.items.properties).toHaveProperty("cwe");
    expect(schema.properties.controls.items.required).toContain("cwe");
  });
});

describe("check wiring", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

  it("sets the exit code of the review script from the mandatory blocker count", () => {
    const script = readFileSync(resolve(root, "scripts/owasp-review-pr.ts"), "utf8");
    expect(script).toContain("owaspCheckExitCode(report)");
  });

  it("passes the script exit code through in both workflows", () => {
    for (const name of ["owasp-review.yml", "owasp-review-reusable.yml"]) {
      const yaml = readFileSync(resolve(root, ".github/workflows", name), "utf8");
      expect(yaml).toContain("scripts/owasp-review-pr.ts --comment");
      expect(yaml).toMatch(/exit "\$code"/);
    }
  });
});
