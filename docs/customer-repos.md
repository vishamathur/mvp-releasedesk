# Customer repos

Each customer request gets its own private repo, created from the template [vishamathur/releasedesk-customer-template](https://github.com/vishamathur/releasedesk-customer-template) **only after the request's finance-approval gate is approved**. The harness repo holds the Release Desk itself, never customer code.

## Name rule

`<customer>-ER` or `<customer>-<request>`: lowercase words joined by dashes. The generic enhancement suffix is the literal `ER`. Examples: `acme-ER`, `acme-kyc-occupation`, `northwind-bank-kyc-identity`. Existing repos are never renamed. The rule is enforced by `customerRepoName` / `validateCustomerRepoName` in `packages/releasedesk-core/src/customer-repo/`.

## Lifecycle

1. Intake (Lead) → estimate (Change Analyst) → **finance-approval** (Vishal types it).
2. `scripts/create-customer-repo.ts` creates the repo (below).
3. Security review and the security-compliance gate. The `owasp-review / review` check fails on any mandatory blocker (authentication failures, access control, hard-coded secrets, anything high or critical), see [OWASP review](security/owasp-review.md#mandatory-blockers).
4. Build: Builder launches the coding agent on the repo from the request `target` (`repository`, `baseRef`). It opens a PR from `cursor/req-<id>-<slug>`.
5. Release gate (Vishal types it) and a human merge.
6. On a rejected gate: `--archive` archives the repo and revokes its key.

## create-customer-repo.ts

```bash
npm run customer-repo -- --customer "Northwind Bank" --customer-id cust_northwind \
  --request kyc-identity --request-id REQ-2026-0001 \
  --state /workspace/releasedesk-state/REQ-2026-0001.json --dry-run
```

Drop `--dry-run` to run it. Steps, in order. Any failure stops the run with the real error, with one exception for branch protection on GitHub Free (below):

| Step | What | Call |
| --- | --- | --- |
| name | Build and validate the name | local |
| finance guard | Refuse unless `decisions[]` or a transition `humanDecision` has `gate: finance-approval`, `status: approved` and a named `decidedBy` | local |
| check-free | Refuse if the repo already exists | `gh repo view` |
| create | Private repo from the template | `gh repo create <owner>/<name> --private --template vishamathur/releasedesk-customer-template` |
| protect | `main`: PR required, 0 GitHub approvals, required checks `ci`, `grok-review / review`, `owasp-review / review`, `acceptance / review`, no force-push, no deletion. On GitHub's 403 plan-upgrade error: record `unavailable-free-plan`, warn, continue. Any other error stops before a key exists | `PUT /repos/{repo}/branches/main/protection` |
| labels | Labels from the template's `.github/labels.yml` | `gh label create --force` |
| mint key | Per-repo Grok key `releasedesk-<owner>-<name>`, ACLs `api-key:endpoint:chat`, `api-key:model:grok-4.3` | xAI Management API `POST https://management-api.x.ai/auth/teams/{teamId}/api-keys` |
| set secret | `RELEASEDESK_GROK_API_KEY_LEAD` from stdin; the value is never printed or put in argv. If this fails the new key is deleted | `gh secret set ... -R <repo>` |
| customer record | `metadata.repository`, `metadata.baseRef` on the customer | `FileCustomerStore` |
| request target | `target: { repository, baseRef, source, setAt, setBy, grokKeyId, protection }` in the state file | local |
| audit | One `customer-repo-audit.v1` line: request, repo, finance approver, key id, `protection`, time | `releasedesk-log/customer-repos.audit.jsonl` |

Archive on reject:

```bash
npm run customer-repo -- --archive --repo vishamathur/acme-ER --request-id REQ-2026-0003 \
  --state /workspace/releasedesk-state/REQ-2026-0003.json [--key-id <apiKeyId>]
```

It refuses unless the state has a rejected gate decision and the state's `target.repository` matches. Then it deletes the key (`DELETE https://management-api.x.ai/auth/api-keys/{apiKeyId}`), deletes the secret, runs `gh repo archive --yes`, marks the target archived and writes an audit line.

## Environment

| Variable | Needed for |
| --- | --- |
| `XAI_MANAGEMENT_API_KEY` | Minting and revoking per-repo keys. A management key from xAI Console → Settings → Management Keys, with permission to create and delete API keys. Missing means the run fails at the mint step. |
| `XAI_TEAM_ID` | Optional. When unset, the team is read from `GET /auth/management-keys/validation`. |
| `gh` login | `repo` scope for create, protection, labels, secrets and archive. Pushing workflow files needs the `workflow` scope too. |

## Review model

No human GitHub approvals are required (`required_approving_review_count: 0`). Review means the required Grok release-intel (`grok-review`), OWASP review (`owasp-review`) and acceptance (`acceptance`) checks plus the typed Release Desk gates (security-compliance and release). A pull request is still required, and `ci` must pass.

## Acceptance testing (QA)

QA is a Builder skill, not a separate agent. Each Given / When / Then criterion gets an id (`AC-1`, `AC-2`, `AC-3.1`). The cloud agent writes at least one test per id in the same PR, with the id in the test name, and lists the ids under `## Acceptance criteria` in the PR body (or in `docs/acceptance/<story>.md`). Tests are real: no mocks of the system under test.

The template's `acceptance.yml` calls `.github/workflows/acceptance-reusable.yml` here. The check is named **`acceptance / review`** and needs no secrets. It:

1. runs the **full suite** once (`npm run test:acceptance`, Jest-format JSON plus Istanbul `coverage-summary.json`);
2. maps each id to pass, fail or missing;
3. fails if any id is missing or failing, **any** test fails, or line coverage is below the threshold (default **80%**, input `coverage_threshold`, `0` turns it off);
4. writes the criteria matrix to the job summary and a `## acceptance v1` PR comment.

Example script for a Vitest app (needs `@vitest/coverage-v8`):

```json
"test:acceptance": "vitest run --coverage.enabled --coverage.reportOnFailure --coverage.reporter=json-summary --coverage.reporter=text --reporter=default --reporter=json --outputFile.json=reports/acceptance-results.json"
```

**Regressions.** Every attempt reruns the full suite, so a broken existing test fails the check. A regression found by a reviewer (for example N10, the lockout regression in REQ-2026-0001 attempt 2) must get a `REG-<finding>` test (`REG-N10`) listed in the PR body before the test gate can pass. PRs labelled `dependencies` need no criteria; the suite and coverage still run.

The test gate needs `ci`, `grok-review`, `owasp-review` and `acceptance` green. Security still confirms blockers and Vishal types the gates.

## Known limits

- **Branch protection on private repos (GitHub Free, no paid upgrade).** GitHub answers the protection call with 403 "Upgrade to GitHub Pro or make this repository public to enable this feature." The script matches that exact message with HTTP 403 only. It then records `protection: "unavailable-free-plan"` in the request target and the audit line, prints a warning that `main` is **not enforced by GitHub** and that enforcement relies on the Release Desk gates (the typed security-compliance and release gates, and required reviews by the Release Desk bots, i.e. the Grok release-intel and OWASP review checks), and continues with labels, key, customer record and target. Any other protection error (other 403s, 404, 422, network) still stops the run before a key exists. `protection` values: `applied`, `unavailable-free-plan`.
- **Reusable review workflows.** The template's `grok-review.yml`, `owasp-review.yml` and `acceptance.yml` call `release-intel-reusable.yml`, `owasp-review-reusable.yml` and `acceptance-reusable.yml` in this repo (`workflow_call`). Those files must land in `.github/workflows/` here first.
- **Acceptance runs PR code.** The `acceptance` job runs the PR's own tests before it posts its comment with the job token. Fork PRs get a read-only token; same-repo PRs come from the Builder cloud agent.
- The tests (`packages/releasedesk-core/src/customer-repo/index.test.ts`, `packages/releasedesk-core/src/acceptance/index.test.ts`) cover the acceptance mapping and the name rule, the finance guard and dry-run planning. They make no network calls.
