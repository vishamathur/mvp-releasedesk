#!/usr/bin/env npx tsx
/**
 * Read a pull request title and changed paths, call grok-release-intel, print JSON.
 * With --comment, print the full `## release-intel v1` PR comment (summary, footer,
 * hidden machine block) instead of the bare JSON.
 * A missing RELEASEDESK_GROK_API_KEY_LEAD exits 1. Never prints the key or a stand-in result.
 */
import { pathToFileURL } from "node:url";
import { releaseIntelForPullRequest } from "../apps/releasedesk/src/lib/release-intel-pr.ts";
import { renderReleaseIntelComment } from "../apps/releasedesk/src/lib/release-intel-comment.ts";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  releaseIntelForPullRequest()
    .then((report) => {
      const asComment = process.argv.includes("--comment");
      process.stdout.write(
        asComment ? `${renderReleaseIntelComment(report)}\n` : `${JSON.stringify(report, null, 2)}\n`,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "release-intel failed";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
