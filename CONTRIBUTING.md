# Contributing

## Flow (trunk-based)

1. Pick a request that meets the [Definition of Ready](./docs/DEFINITION_OF_READY.md).
2. Branch from `main`: `cursor/<topic>` for harness work, or `cursor/req-<requestId>-<slug>` when a request drives it. Keep it short-lived, ideally under 2 days of work.
3. Commit in small steps with conventional commits.
4. Open a pull request into `main` early (draft is fine). Fill in the template.
5. The required checks `test` (ci), `intel` (release-intel) and `review` (owasp-review) must pass. Review means the required Grok release-intel (`intel` (release-intel)) and OWASP review (`review` (owasp-review)) checks plus the typed Release Desk gates (security-compliance and release). No human GitHub approval is required.
6. Merge with a merge commit after the release gate. No squash, no rebase, no force-push. Delete the branch after merge.

`main` stays releasable. If `main` breaks, fixing it is the team's first priority.

## Conventional commits

```
<type>(<optional scope>): <summary in the imperative, under 72 chars>

<body: why, not what>

Refs: REQ-YYYY-NNNN
```

Scopes in this repo: `core`, `lead`, `specialists`, `desk`, `kyc`, `owasp`, `release-intel`, `customer-repo`, `ci`, `docs`.

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `security`, `revert`. Breaking changes use `!` after the type or a `BREAKING CHANGE:` footer.

Examples:

- `feat(kyc): add optional occupation field`
- `fix(api): reject oversized request bodies`
- `security(store): encrypt the applicant store at rest`

## Pull requests

- One request or story per PR. Aim for under 400 changed lines; split bigger work.
- Link the request id, tick the acceptance criteria and the Definition of Done, paste test evidence.
- Resolve every Grok release-intel blocker and OWASP failure the checks report, or explain it in the PR, within the SLA in the [working agreement](./docs/WORKING_AGREEMENT.md).
