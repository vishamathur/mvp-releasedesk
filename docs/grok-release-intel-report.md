# release-intel report: format and how Builder uses it

The `release-intel` GitHub Action calls the Grok API on every pull request and keeps one comment up to date. Its first line is `## release-intel v1`. The comment is advisory. Grok never approves a merge or a release, and the Security gate and the human gates stay in force.

## What the comment shows

- The head commit the report is about (`headSha`), the risk tier and score, and the blockers Grok listed.
- One footer line: the model that answered, prompt and completion tokens, latency in milliseconds, and an **estimated** cost. The estimate comes from a dated public price table in `packages/releasedesk-core/src/grok-telemetry.ts`. It is not a bill. When the API response has no `usage`, or the model has no listed price, the line says so and the cost is `n/a`.
- A hidden machine block, `<!-- release-intel-json:v1 ... -->`, and a collapsed copy of the full report.

## Model

`GROK_MODEL` (environment variable, or the `GROK_MODEL` repository variable in CI) picks the model. The default is `grok-4.3`. The report records both `requestedModel` and `model`, where `model` is what the response reported. If the response carries no `model`, `modelReported` is `false`.

## Machine fields (`schema: "release-intel.v1"`)

`headSha`, `headShaSource` (`env`, `github` or `unavailable`), `generatedAt`, `repository`, `pullRequest`, `filesTotal`, `filesSent`, and `intel`:
`model`, `requestedModel`, `modelReported`, `riskTier`, `score`, `blockers`, `classify`, `extract`, `summarize`, `trustCheck`, and `telemetry` (`promptTokens`, `completionTokens`, `reasoningTokens`, `totalTokens`, `latencyMs`, `estUsd`, `estNote`).

## How Builder uses it

`launch-cursor-build` step 5a-5e: read the comment for the PR head SHA, check `headSha`, write a digest to `/workspace/releasedesk-state/<requestId>-grok-intel-<sha7>.json`, compare with Security's open blocker count, and put one line in `build-result` (`testsSummary` and `summary`, with the comment URL and digest path in `artifactRefs`). If there is no report for the SHA, Builder says so with the reason. A disagreement between Grok and Security goes on the release-gate card; Security's count stands and Vishal decides.

## Reading it in code

`parseReleaseIntelComment(body)` and `matchReleaseIntelSha(report, sha)` in `apps/releasedesk/src/lib/release-intel-comment.ts`.

## Workflow wiring

`scripts/release-intel-pr.ts --comment` prints the whole comment. The workflow passes `PR_HEAD_SHA`, `GROK_MODEL` and posts that output unchanged. Without `--comment` the script prints the bare JSON report, which already includes `headSha` and `telemetry`.
