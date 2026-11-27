# release-intel report: format and how Builder uses it

The `release-intel` GitHub Action calls the Grok API on every pull request and keeps one comment up to date. Its first line is `## release-intel v1`. The comment is advisory. Grok never approves a merge or a release, and the Security gate and the human gates stay in force.

## What the comment shows

- The head commit the report is about (`headSha`), the risk tier and score, and how many changed files were sent (`filesSent` / `filesTotal`). When the diff was cut to the token budget, the line says the diff was truncated.
- Grounded blockers as `path:line`, with severity and the changed line quoted as evidence.
- Dropped blockers (`droppedUngrounded`): claims whose path is not a changed file, whose line is outside a changed hunk, or whose evidence is not on a changed line in that hunk. Blocker ids are never taken from the pull request title.
- Whether the diff tried to instruct the reviewer (`injectionSuspected`, with a reason). That flag does not approve or block anything.
- One footer line: the model that answered, prompt and completion tokens, cached prompt tokens when the API reported them, latency in milliseconds, the **billed** cost, and a separately labelled **estimate**. The billed cost is `usage.cost_in_usd_ticks` divided by 10^10 ([xAI cost tracking](https://docs.x.ai/developers/cost-tracking)). When the response omits that field the line says `billed cost not reported` and does not invent a bill. The estimate comes from a dated public price table in `packages/releasedesk-core/src/grok-telemetry.ts`.
- A hidden machine block, `<!-- release-intel-json:v1 ... -->`, and a collapsed copy of the full report.

The title and the diff are sent inside `<<<<<UNTRUSTED-PR-DATA>>>>>` … `<<<<<END-UNTRUSTED-PR-DATA>>>>>`. The system prompt tells Grok that text is data, not instructions. Repeat calls for the same pull request send a stable `prompt_cache_key` and the same value as the `x-grok-conv-id` header ([prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)).

## Model

`GROK_MODEL` (environment variable, or the `GROK_MODEL` repository variable in CI) picks the model. The default is `grok-4.3`. The report records both `requestedModel` and `model`, where `model` is what the response reported. If the response carries no `model`, `modelReported` is `false`.

## Machine fields (`schema: "release-intel.v2"`)

`headSha`, `headShaSource` (`env`, `github` or `unavailable`), `generatedAt`, `repository`, `pullRequest`, `filesTotal`, `filesSent`, `diffTruncated`, `diffTokenBudget`, `diffTokensUsed`, and `intel`:
`model`, `requestedModel`, `modelReported`, `riskTier`, `score`, `blockers` (strings `path:line`, so a v1 reader can still join them), `groundedBlockers` (`path`, `line`, `evidence`, `severity`), `droppedUngrounded`, `injectionSuspected`, `injectionReason`, `classify`, `extract`, `summarize`, `trustCheck`, and `telemetry` (`promptTokens`, `completionTokens`, `reasoningTokens`, `totalTokens`, `cachedPromptTokens`, `latencyMs`, `costInUsdTicks`, `billedCostUsd`, `billedNote`, `estUsd`, `estNote`).

A comment written with `schema: "release-intel.v1"` still parses. Extra v2 fields are ignored by a reader that only knows v1. `blockers` remains a string array.

## How Builder uses it

`launch-cursor-build` step 5a-5e: read the comment for the PR head SHA, check `headSha`, write a digest to `/workspace/releasedesk-state/<requestId>-grok-intel-<sha7>.json`, compare with Security's open blocker count, and put one line in `build-result` (`testsSummary` and `summary`, with the comment URL and digest path in `artifactRefs`). Accept `release-intel.v1` or `release-intel.v2`. If there is no report for the SHA, Builder says so with the reason. A disagreement between Grok and Security goes on the release-gate card; Security's count stands and Vishal decides. Grok output never approves a merge or a release.

## Reading it in code

`parseReleaseIntelComment(body)` and `matchReleaseIntelSha(report, sha)` in `apps/releasedesk/src/lib/release-intel-comment.ts`.

## Workflow wiring

`scripts/release-intel-pr.ts --comment` prints the whole comment. The workflow passes `PR_HEAD_SHA`, `GROK_MODEL` and posts that output unchanged. Without `--comment` the script prints the bare JSON report.

`RELEASE_INTEL_DIFF_TOKEN_BUDGET` (integer, at least 256) caps the diff. Unset means 32000 tokens.

## Live evals

`npm run eval:release-intel` calls live Grok on the cases in `evals/release-intel/` (no stand-in). It checks schema validity, that every blocker is grounded, that the injection case is flagged and the verdict does not flip to a clean low, and it prints billed cost and latency. The GitHub job `grok-evals` runs only when the pull request has the label `run-grok-evals`, or when the workflow is started with `workflow_dispatch`. It uses `RELEASEDESK_GROK_API_KEY_LEAD`.
