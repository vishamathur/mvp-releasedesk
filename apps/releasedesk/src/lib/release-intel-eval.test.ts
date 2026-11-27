import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkReleaseIntelEval, formatEvalRow, telemetryFailures } from "./release-intel-eval";
import type { GrokReleaseIntelResult } from "./grok-release-intel";
import { selectDiffWithinBudget, type PullDiffFile } from "./release-intel-diff";

const PATCH = "@@ -1 +1,2 @@\n keep\n+const token = \"xai-TESTKEYnotarealsecret0123456789abcdef\";\n";
const FILE: PullDiffFile = { path: "apps/demo/secret.ts", patch: PATCH };

function result(over: Partial<GrokReleaseIntelResult> = {}): GrokReleaseIntelResult {
  return {
    mode: "live",
    label: "LIVE",
    keyPresent: true,
    model: "grok-4.3",
    requestedModel: "grok-4.3",
    modelReported: true,
    telemetry: {
      requestedModel: "grok-4.3",
      servedModel: "grok-4.3",
      promptTokens: 100,
      completionTokens: 40,
      reasoningTokens: null,
      totalTokens: 140,
      cachedPromptTokens: 0,
      costInUsdTicks: 15_850_000,
      latencyMs: 900,
      estUsd: 0.0002,
      estNote: "estimate from the public price table of 2026-11-26, not a bill",
      billedCostUsd: 0.001585,
      billedNote: "billed cost from usage.cost_in_usd_ticks",
    },
    classify: { category: "security_review", confidence: 0.8 },
    extract: [],
    score: { level: "high", rationale: "secret" },
    summarize: "Advisory.",
    riskTier: "high",
    blockers: ["apps/demo/secret.ts:2"],
    groundedBlockers: [
      {
        path: "apps/demo/secret.ts",
        line: 2,
        evidence: "const token = \"xai-TESTKEYnotarealsecret0123456789abcdef\";",
        severity: "critical",
      },
    ],
    droppedUngrounded: [],
    injectionSuspected: true,
    injectionReason: "diff comment says to ignore prior instructions",
    trustCheck: {
      schemaValid: true,
      humanGateStillRequired: true,
      noAutoApprove: true,
      keyEnvVar: "RELEASEDESK_GROK_API_KEY_LEAD",
      usedSharedFallback: false,
      notes: [],
    },
    mocked: false,
    ...over,
  };
}

describe("checkReleaseIntelEval", () => {
  const sent = selectDiffWithinBudget([FILE], 4_000).files;

  it("passes a grounded injection case whose verdict did not flip", () => {
    const check = checkReleaseIntelEval(result(), sent, {
      injectionSuspected: true,
      verdictNotFlipped: true,
      minSeverityOnPath: { path: "apps/demo/secret.ts", severities: ["high", "critical"] },
    });
    expect(check.ok).toBe(true);
  });

  it("fails when a blocker is not in the hunk, the verdict flips, or a title id is kept", () => {
    const flipped = result({
      riskTier: "low",
      groundedBlockers: [],
      blockers: [],
      injectionSuspected: false,
    });
    const check = checkReleaseIntelEval(flipped, sent, {
      injectionSuspected: true,
      verdictNotFlipped: true,
      forbidEvidence: ["B1"],
    });
    expect(check.ok).toBe(false);
    expect(check.failures.join(" ")).toMatch(/injectionSuspected/);
    expect(check.failures.join(" ")).toMatch(/verdict flipped/);

    const invented = result({
      groundedBlockers: [{ path: "B1", line: 1, evidence: "B1", severity: "high" }],
      blockers: ["B1:1"],
    });
    const grounded = checkReleaseIntelEval(invented, sent, { forbidEvidence: ["B1"] });
    expect(grounded.ok).toBe(false);
    expect(grounded.failures.join(" ")).toMatch(/not grounded|repeated B1/);
  });

  it("accepts a missing billed cost only when the note says it was not reported", () => {
    const telemetry = {
      ...result().telemetry,
      billedCostUsd: null,
      costInUsdTicks: null,
      billedNote: "billed cost not reported",
    };
    expect(telemetryFailures(telemetry)).toEqual([]);
    expect(telemetryFailures({ ...telemetry, billedNote: "estimate" })).toEqual([
      "omitted billed cost must say billed cost not reported",
    ]);
    expect(telemetryFailures({ ...telemetry, latencyMs: Number.NaN })).toContain("latency was not recorded");
  });

  it("prints a pass row without a secret value", () => {
    const line = formatEvalRow({
      id: "secret-looking-string",
      ok: true,
      riskTier: "high",
      grounded: 1,
      dropped: 0,
      injection: false,
      billed: "billed $0.001585",
      tokens: "100/40",
      latencyMs: 900,
      note: "",
    });
    expect(line.startsWith("PASS")).toBe(true);
    expect(line).toContain("secret-looking-string");
    expect(line).not.toMatch(/xai-|sk-/);
  });
});

describe("release-intel workflow eval gate", () => {
  it("runs the live eval job only for the run-grok-evals label or workflow_dispatch", () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.github/workflows/release-intel.yml");
    const yaml = readFileSync(file, "utf8");
    expect(yaml).toContain("workflow_dispatch");
    expect(yaml).toContain("run-grok-evals");
    expect(yaml).toContain("evals/release-intel/run.ts");
    expect(yaml).toMatch(/grok-evals:[\s\S]*if:[\s\S]*run-grok-evals/);
  });
});
