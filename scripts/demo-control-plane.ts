#!/usr/bin/env npx tsx
/**
 * One runnable enterprise SDLC control-plane demo (headless).
 *
 *   npm run build:core && npm run build:lead && npm run build:specialists
 *   npm run demo:control-plane
 *
 * Live Desk UI: npm run desk → http://localhost:3001/control
 */
import { buildControlPlaneSnapshot } from "../apps/releasedesk/src/lib/control-plane.ts";

async function main() {
  const snap = await buildControlPlaneSnapshot();
  console.log(snap.title);
  console.log(`generatedAt: ${snap.generatedAt}\n`);
  for (const stage of snap.stages) {
    console.log(`[${stage.status}] ${stage.label}`);
    console.log(`  ${stage.summary}`);
    if (stage.detail) console.log(`  ${stage.detail}`);
  }
  console.log("\nGrok API ship (classify/extract/score/summarize):");
  for (const [name, r] of Object.entries(snap.ship.specialistIntel)) {
    console.log(`  ${name}: mocked=${r.mocked} · ${r.text.slice(0, 120)}`);
  }
  console.log("\nDemo path:");
  for (const line of snap.demoPath) console.log(`  ${line}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
