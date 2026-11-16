#!/usr/bin/env npx tsx
/**
 * Room demo: Cursor-shipped Grok API intel path (classify/extract/score/summarize).
 * File: packages/releasedesk-specialists/src/grok-api-intel.ts
 *
 *   export RELEASEDESK_GROK_API_KEY_BUILDER=...   # exclusive — never XAI_API_KEY
 *   npm run build:specialists && npm run demo:grok-intel
 */
import {
  classifyReleaseFindings,
  extractReleaseActions,
  scoreReleaseRisk,
  summarizeReleaseFindings,
} from "@releasedesk/specialists";

const findings = [
  {
    id: "f1",
    sourceAgent: "security",
    summary: "CVE sample advisory correlates to lodash in workspace",
    severity: "high",
  },
  {
    id: "f2",
    sourceAgent: "standards",
    summary: "Retention label missing on KYC export path",
    severity: "medium",
  },
];

async function main() {
  const keyPresent = Boolean(process.env.RELEASEDESK_GROK_API_KEY_BUILDER?.trim());
  console.log("ship file: packages/releasedesk-specialists/src/grok-api-intel.ts");
  console.log(
    keyPresent
      ? "RELEASEDESK_GROK_API_KEY_BUILDER present → live Grok API"
      : "RELEASEDESK_GROK_API_KEY_BUILDER missing → MOCK (shared XAI_API_KEY ignored)",
  );

  const classified = await classifyReleaseFindings(findings);
  const extracted = await extractReleaseActions(findings);
  const scored = await scoreReleaseRisk(findings);
  const summarized = await summarizeReleaseFindings(findings);

  for (const [name, result] of [
    ["classify", classified],
    ["extract", extracted],
    ["score", scored],
    ["summarize", summarized],
  ] as const) {
    console.log(`\n[${name}] mocked=${result.mocked} keyRole=${result.keyRole}`);
    console.log(result.text.slice(0, 500));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
