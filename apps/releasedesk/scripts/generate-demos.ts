#!/usr/bin/env node
/**
 * Generate recorded demo run-context fixtures by driving the Lead orchestrator.
 *
 * Usage (from apps/releasedesk or repo root via workspace script):
 *   npm run generate:demos -w @releasedesk/ui
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInMemoryStore } from "@releasedesk/core";
import {
  LeadOrchestrator,
  createMockPrClient,
} from "@releasedesk/lead";
import { DEMO_SCENARIOS, runnersForScenario } from "../src/lib/scenarios.ts";
import type { DeskReport } from "../src/lib/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../fixtures/demos");

async function main() {
  await mkdir(fixturesDir, { recursive: true });

  for (const meta of DEMO_SCENARIOS) {
    const cfg = runnersForScenario(meta.id);
    const store = createInMemoryStore();
    const lead = new LeadOrchestrator({
      store,
      runners: cfg.runners,
      enableRemediation: cfg.enableRemediation,
      maxRemediationCycles: cfg.maxRemediationCycles,
      prClient: { client: createMockPrClient() },
    });

    const report = await lead.startOnDemandCheck({
      goal: cfg.goal,
      target: {
        repository: "vishamathur/mvp-releasedesk",
        baseRef: "main",
        headRef: "HEAD",
      },
      trigger: {
        requestedBy: "demo-fixture-generator",
        notes: `Recorded fixture for scenario ${meta.id}`,
      },
      metadata: { scenarioId: meta.id, scenarioLabel: meta.title },
    });

    const desk: DeskReport = {
      runId: report.runId,
      scenarioId: meta.id,
      scenarioLabel: meta.title,
      createdAt: report.run.createdAt,
      updatedAt: report.run.updatedAt,
      prClientMode: "mock",
      autoMerge: false,
      report,
      dmSession: report.dmSession,
    };

    const out = path.join(fixturesDir, `${meta.id}.json`);
    await writeFile(out, `${JSON.stringify(desk, null, 2)}\n`, "utf8");
    console.log(
      `Wrote ${meta.id} → ${out} (readiness=${report.leadOutput.readiness}, tasks=${report.run.tasks.length}, audit=${report.run.auditTrail.length})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
