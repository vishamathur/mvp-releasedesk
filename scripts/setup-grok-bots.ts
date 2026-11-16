#!/usr/bin/env npx tsx
/**
 * Print create-in-app instructions for Release Desk Grok Bots.
 * There is no public Bot create API — this script is the setup surface.
 */
import {
  GROK_BOT_DEFINITIONS,
  GROK_BOT_TRIAD_IDS,
  listRequiredAgentApiKeyEnvVars,
} from "@releasedesk/core";

const triad = new Set<string>(GROK_BOT_TRIAD_IDS);

console.log("=== Release Desk — Grok Bot setup ===\n");
console.log("Docs: https://docs.x.ai/grok-bot/bots");
console.log("Webhooks: https://docs.x.ai/grok-bot/skills-routines-and-automations\n");
console.log("Exclusive secrets required (never shared XAI_API_KEY / CURSOR_API_KEY):\n");
for (const name of listRequiredAgentApiKeyEnvVars()) {
  console.log(`  ${name}=`);
}
console.log("\nOptional webhook secrets (after creating routines in Grok Bot app):\n");
for (const bot of GROK_BOT_DEFINITIONS) {
  for (const r of bot.routines) {
    if (r.webhookUrlEnv) console.log(`  ${r.webhookUrlEnv}=`);
    if (r.webhookKeyEnv) console.log(`  ${r.webhookKeyEnv}=`);
  }
}

console.log("\n=== Create each Bot (New Bot in Grok Bot app) ===\n");
for (const bot of GROK_BOT_DEFINITIONS) {
  const badge = triad.has(bot.id) ? " [TRIAD]" : "";
  console.log(`--- ${bot.displayName}${badge} ---`);
  console.log(`definition: ${bot.definitionPath}`);
  console.log(`key: ${bot.grokApiKeyEnv}`);
  console.log(`open live: Grok Bot → ${bot.displayName}`);
  console.log(`firstMessage:\n${bot.firstMessage}\n`);
}

console.log("=== Cursor Cloud Agents (Coding · Testing · Review) ===");
console.log("keys: RELEASEDESK_CURSOR_API_KEY_CODING|TESTING|REVIEW");
console.log("enable: RELEASEDESK_CLOUD_CLIENT=real\n");

console.log("=== Cursor → Grok API ship path (one) ===");
console.log("file: packages/releasedesk-specialists/src/grok-api-intel.ts");
console.log("run:  export RELEASEDESK_GROK_API_KEY_BUILDER=...");
console.log("      npm run build:specialists && npm run demo:grok-intel\n");
