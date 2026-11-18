#!/usr/bin/env npx tsx
/**
 * Create SpaceXAI Grok Bots from grok-bots/definitions/*.json
 *
 * Env (exclusive per agent — no XAI_API_KEY fallback):
 *   RELEASEDESK_GROK_API_KEY_LEAD
 *   RELEASEDESK_GROK_API_KEY_CHANGE_ANALYST
 *   RELEASEDESK_GROK_API_KEY_STANDARDS
 *   RELEASEDESK_GROK_API_KEY_SECURITY
 *   RELEASEDESK_GROK_API_KEY_BUILDER
 *
 * Optional:
 *   RELEASEDESK_GROK_BOT_API_BASE   (default https://api.x.ai/v1)
 *   RELEASEDESK_GROK_BOT_CREATE_PATH (default /agents — /bots is not a public xAI route)
 *   RELEASEDESK_GROK_BOT_DRY_RUN=1
 *
 * Usage:
 *   npm run create:grok-bots
 *   npm run create:grok-bots -- --dry-run
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGrokBotApiClient,
  listGrokBotDefinitions,
  type GrokBotRegistry,
} from "../packages/releasedesk-core/src/grok-bots/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRunArg = process.argv.includes("--dry-run");

async function main() {
  const defs = await listGrokBotDefinitions(root);
  console.log(`Loaded ${defs.length} bot definition(s) from grok-bots/definitions/`);
  for (const d of defs) {
    console.log(`  - ${d.id}  key=${d.apiKeyEnv}  pack=${d.markdownPackDir}`);
  }

  const client = createGrokBotApiClient({
    dryRun: dryRunArg || process.env.RELEASEDESK_GROK_BOT_DRY_RUN === "1",
  });
  const results = await client.createBots(defs);

  const registry: GrokBotRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: results.map((r) => ({
      definitionId: r.definitionId,
      liveBotId: r.liveBotId,
      createdAt: r.status === "created" ? new Date().toISOString() : null,
      lastError: r.status === "error" ? r.message : null,
      status:
        r.status === "created"
          ? ("created" as const)
          : r.status === "skipped_missing_key"
            ? ("skipped_missing_key" as const)
            : r.status === "dry_run"
              ? ("not_created" as const)
              : ("error" as const),
    })),
  };

  const registryPath = path.join(root, "grok-bots", "registry.json");
  // Only rewrite registry when we have real creates or explicit skip states — never invent IDs.
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  console.log("\nResults:");
  for (const r of results) {
    console.log(
      `  ${r.definitionId}: ${r.status}  liveBotId=${r.liveBotId ?? "null"}  ${r.message}`,
    );
  }
  console.log(`\nRegistry written: ${registryPath}`);
  console.log(
    "Definition paths: grok-bots/definitions/{lead,change-analyst,standards,security,builder}.json",
  );

  const missing = results.filter((r) => r.status === "skipped_missing_key");
  if (missing.length) {
    console.log(
      `\n${missing.length} bot(s) skipped — set exclusive RELEASEDESK_GROK_API_KEY_* then re-run.`,
    );
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
