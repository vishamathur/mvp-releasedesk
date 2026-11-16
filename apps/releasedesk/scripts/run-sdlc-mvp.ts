/**
 * CLI portfolio check for the SDLC MVP surface.
 * Usage: npm run sdlc:mvp
 */
import { runSdlcMvpPortfolioCheck } from "../src/lib/sdlc-mvp";

async function main() {
  const report = await runSdlcMvpPortfolioCheck();
  const lines = [
    `SDLC MVP portfolio · ${report.generatedAt}`,
    `customers=${report.requirements.agility.customersChecked} tagged=${report.requirements.agility.allTaggedWithCustomerId}`,
    `securityOk=${report.requirements.security.allCustomersOk}`,
    `tokenSavings≈${report.requirements.tokenEfficiency.totalSavingsTokensEst} avgPct=${report.requirements.tokenEfficiency.averageSavingsPct}`,
    report.mockNote,
  ];
  for (const c of report.customers) {
    lines.push(
      `- ${c.customerId} ${c.customerName}/${c.application} run=${c.runId} security=${c.security.status} savings=${c.tokenBudget.savingsTokensEst}`,
    );
  }
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
