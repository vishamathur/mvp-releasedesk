#!/usr/bin/env npx tsx
/**
 * Live Grok evals for release intel. No stand-in result.
 * A missing RELEASEDESK_GROK_API_KEY_LEAD exits 1. The key is never printed.
 */
import { pathToFileURL } from "node:url";
import { BILLED_COST_NOT_REPORTED } from "@releasedesk/core";
import { runGrokReleaseIntel } from "../../apps/releasedesk/src/lib/grok-release-intel.ts";
import { selectDiffWithinBudget } from "../../apps/releasedesk/src/lib/release-intel-diff.ts";
import { checkReleaseIntelEval, formatEvalRow } from "../../apps/releasedesk/src/lib/release-intel-eval.ts";
import { RELEASE_INTEL_EVAL_CASES } from "./cases.ts";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

export async function runReleaseIntelEvals(): Promise<number> {
  if (RELEASE_INTEL_EVAL_CASES.length < 6 || RELEASE_INTEL_EVAL_CASES.length > 8) {
    throw new Error(`expected 6 to 8 eval cases, found ${RELEASE_INTEL_EVAL_CASES.length}`);
  }
  let failed = 0;
  process.stdout.write(`release-intel evals (${RELEASE_INTEL_EVAL_CASES.length} cases, live Grok)\n`);
  for (const evalCase of RELEASE_INTEL_EVAL_CASES) {
    const diff = selectDiffWithinBudget(evalCase.files, 8_000);
    const started = Date.now();
    try {
      const result = await runGrokReleaseIntel({
        repository: "vishamathur/mvp-releasedesk",
        goal: evalCase.title,
        pullRequest: evalCase.pullRequest,
        findings: [],
        diff,
        knownPaths: evalCase.files.map((file) => file.path),
      });
      const check = checkReleaseIntelEval(result, diff.files, evalCase.expect);
      if (!check.ok) failed += 1;
      const billed =
        result.telemetry.billedCostUsd === null
          ? BILLED_COST_NOT_REPORTED
          : `billed $${result.telemetry.billedCostUsd.toFixed(6)}`;
      const tokens =
        result.telemetry.promptTokens === null
          ? "tokens not reported"
          : `${result.telemetry.promptTokens}/${result.telemetry.completionTokens ?? "?"}` +
            (result.telemetry.cachedPromptTokens === null
              ? ""
              : ` cached=${result.telemetry.cachedPromptTokens}`);
      process.stdout.write(
        `${formatEvalRow({
          id: evalCase.id,
          ok: check.ok,
          riskTier: result.riskTier,
          grounded: result.groundedBlockers.length,
          dropped: result.droppedUngrounded.length,
          injection: result.injectionSuspected,
          billed,
          tokens,
          latencyMs: result.telemetry.latencyMs,
          note: check.failures.join("; "),
        })}\n`,
      );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "eval failed";
      process.stdout.write(
        `${formatEvalRow({
          id: evalCase.id,
          ok: false,
          riskTier: "error",
          grounded: 0,
          dropped: 0,
          injection: false,
          billed: "n/a",
          tokens: "n/a",
          latencyMs: Date.now() - started,
          note: message,
        })}\n`,
      );
    }
  }
  process.stdout.write(`${failed === 0 ? "PASS" : "FAIL"} ${RELEASE_INTEL_EVAL_CASES.length - failed}/${RELEASE_INTEL_EVAL_CASES.length}\n`);
  return failed === 0 ? 0 : 1;
}

if (isDirectRun()) {
  runReleaseIntelEvals()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "release-intel evals failed";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
