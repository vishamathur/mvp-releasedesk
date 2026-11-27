#!/usr/bin/env npx tsx
/**
 * Review the current pull request and print the owasp-review v1 report.
 * With --comment, print the PR comment (summary plus hidden machine block).
 * Exit 1 when the review failed or any mandatory blocker is open. Exit 0 when it completed
 * without one, or was skipped.
 * Never prints a key value.
 */
import { pathToFileURL } from "node:url";
import { renderOwaspReviewComment } from "../packages/releasedesk-core/src/owasp-review/comment.ts";
import { owaspReviewForPullRequest } from "../packages/releasedesk-core/src/owasp-review/pr.ts";
import { owaspCheckExitCode } from "../packages/releasedesk-core/src/owasp-review/mandatory-blockers.ts";
import { failedOwaspReview, redactSensitive } from "../packages/releasedesk-core/src/owasp-review/review.ts";
import type { OwaspReviewReport } from "../packages/releasedesk-core/src/owasp-review/types.ts";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function writeReport(report: OwaspReviewReport): void {
  const asComment = process.argv.includes("--comment");
  const text = asComment ? renderOwaspReviewComment(report) : JSON.stringify(report, null, 2);
  process.stdout.write(`${text}\n`);
}

if (isDirectRun()) {
  owaspReviewForPullRequest()
    .then((report) => {
      writeReport(report);
      process.exitCode = owaspCheckExitCode(report);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "owasp review failed";
      const pullNumber = Number(process.env.PR_NUMBER);
      writeReport(
        failedOwaspReview({
          error: redactSensitive(message, []).slice(0, 500),
          repository: process.env.GITHUB_REPOSITORY,
          pullRequest: Number.isInteger(pullNumber) && pullNumber > 0 ? pullNumber : null,
          headSha: process.env.PR_HEAD_SHA ?? null,
        }),
      );
      process.exitCode = 1;
    });
}
