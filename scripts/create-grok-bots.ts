#!/usr/bin/env npx tsx
/**
 * Optional xAI Agents API create for bots that are NOT already Grok Bot app teammates.
 *
 * The five Release Desk bots live in the Grok Bot app. Their ids are
 * `grokBotAppAgentId` in grok-bots/registry.json (host `grok-bot-app`).
 * Those ids are not xAI Agents API ids. This script does not POST them,
 * does not send them as liveBotId, and does not clear a created_in_grok_bot_app row.
 *
 * App bots do not take API keys. Exclusive RELEASEDESK_GROK_API_KEY_* values
 * authenticate Desk / specialist calls to the xAI chat completions API.
 * They are not Grok Bot app credentials.
 *
 * Env (exclusive per agent — no XAI_API_KEY fallback), only if an xAI create is attempted:
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
  applyCreateResultsToRegistry,
  createGrokBotApiClient,
  DEFAULT_GROK_BOT_API_BASE,
  isGrokBotAppRegistryEntry,
  listGrokBotDefinitions,
  loadGrokBotRegistry,
  type GrokBotCreateAttempt,
} from "../packages/releasedesk-core/src/grok-bots/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRunArg = process.argv.includes("--dry-run");

async function main() {
  const defs = await listGrokBotDefinitions(root);
  console.log(`Loaded ${defs.length} bot definition(s) from grok-bots/definitions/`);
  for (const d of defs) {
    console.log(`  - ${d.id}  key=${d.apiKeyEnv}  pack=${d.markdownPackDir}`);
  }

  const existing = await loadGrokBotRegistry(root);
  const appById = new Map(
    existing.entries
      .filter((entry) => isGrokBotAppRegistryEntry(entry))
      .map((entry) => [entry.definitionId, entry]),
  );

  if (appById.size > 0) {
    console.log(
      `\nPreserving ${appById.size} Grok Bot app teammate(s). Their agent ids are not xAI API ids and will not be sent to ${DEFAULT_GROK_BOT_API_BASE}.`,
    );
    for (const entry of appById.values()) {
      console.log(
        `  - ${entry.definitionId}: grokBotAppAgentId=${entry.grokBotAppAgentId} (${entry.grokBotAppName ?? "app"})`,
      );
    }
  }

  const pending = defs.filter((d) => !appById.has(d.id));
  const client = createGrokBotApiClient({
    dryRun: dryRunArg || process.env.RELEASEDESK_GROK_BOT_DRY_RUN === "1",
  });
  const created = pending.length > 0 ? await client.createBots(pending) : [];

  const attempts: GrokBotCreateAttempt[] = [
    ...[...appById.values()].map((entry) => ({
      definitionId: entry.definitionId,
      liveBotId: null,
      status: "preserved_grok_bot_app" as const,
      message: `Created in the Grok Bot app (${entry.grokBotAppAgentId}); xAI Agents API not called`,
    })),
    ...created.map((r) => ({
      definitionId: r.definitionId,
      liveBotId: r.liveBotId,
      status: r.status,
      message: r.message,
    })),
  ];

  const registry = applyCreateResultsToRegistry(
    existing,
    defs.map((d) => d.id),
    attempts,
    new Date().toISOString(),
  );

  const registryPath = path.join(root, "grok-bots", "registry.json");
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  console.log("\nResults:");
  for (const r of attempts) {
    const saved = registry.entries.find((e) => e.definitionId === r.definitionId);
    console.log(
      `  ${r.definitionId}: ${r.status}  host=${saved?.host ?? "none"}  liveBotId=${saved?.liveBotId ?? "null"}  grokBotAppAgentId=${saved?.grokBotAppAgentId ?? "null"}  ${r.message}`,
    );
  }
  console.log(`\nRegistry written: ${registryPath}`);
  console.log(
    "Definition paths: grok-bots/definitions/{lead,change-analyst,standards,security,builder}.json",
  );

  const missing = created.filter((r) => r.status === "skipped_missing_key");
  if (missing.length) {
    console.log(
      `\n${missing.length} bot(s) skipped — set exclusive RELEASEDESK_GROK_API_KEY_* then re-run. Shared XAI_API_KEY / GROK_API_KEY are ignored.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
