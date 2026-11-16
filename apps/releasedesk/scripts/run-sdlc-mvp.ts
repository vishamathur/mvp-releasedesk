#!/usr/bin/env node
/**
 * CLI: run the SDLC MVP portfolio check (stubs + MOCK PR).
 *
 * Usage (from repo root):
 *   npm run sdlc:mvp
 *   npm run sdlc:mvp -w @releasedesk/ui
 */
import { runSdlcMvpPortfolioCheck } from "../src/lib/sdlc-mvp.ts";

async function main() {
  const report = await runSdlcMvpPortfolioCheck();
  const lines = [
    "SDLC MVP portfolio check",
    `generatedAt: ${report.generatedAt}`,
    "",
    "Requirements:",
    `  agility: ${report.requirements.agility.customersChecked} customers, tagged=${report.requirements.agility.allTaggedWithCustomerId}`,
    `  security: mandatory, allOk=${report.requirements.security.allCustomersOk}`,
    `  tokenEfficiency: ~${report.requirements.tokenEfficiency.totalSavingsTokensEst} tokens saved (avg ${report.requirements.tokenEfficiency.averageSavingsPct}%)`,
    "",
    "Customers:",
  ];
  for (const c of report.customers) {
    lines.push(
      `  ${c.customerId} · ${c.customerName} · readiness=${c.readiness} · securityOk=${c.security.ok} · sliceSave=${c.tokenBudget.savingsTokensEst} (${c.tokenBudget.savingsPct}%)`,
    );
  }
  lines.push("");
  lines.push("Credentials (presence only):");
  for (const cred of report.credentials) {
    lines.push(`  ${cred.agentId} ${cred.envVar}=${cred.present ? "present" : "missing"}`);
  }
  lines.push("");
  lines.push(report.mockNote);
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
