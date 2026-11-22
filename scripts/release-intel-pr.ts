#!/usr/bin/env npx tsx
/**
 * Read a pull request title and changed paths, call grok-release-intel, print JSON.
 * A missing RELEASEDESK_GROK_API_KEY_LEAD yields a MOCK-labelled result and exit 0.
 * Never prints the key.
 */
import { pathToFileURL } from "node:url";
import { releaseIntelForPullRequest } from "../apps/releasedesk/src/lib/release-intel-pr.ts";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  releaseIntelForPullRequest()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "release-intel failed";
      process.stdout.write(
        `${JSON.stringify({ heading: "release-intel v1", label: "MOCK", mode: "mock", error: message }, null, 2)}\n`,
      );
      process.exitCode = 0;
    });
}
