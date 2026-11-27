# Security policy

## Reporting a vulnerability

Do not open a public issue. Report privately through GitHub's **Report a vulnerability** (Security tab → Advisories), or contact the repo owner @vishamathur. Include the affected path, steps to reproduce and impact. Expect an acknowledgement within 2 business days.

## How security is enforced

- Every pull request into `main` runs `owasp-review` (OWASP Top 10, extra web checks, OWASP LLM Top 10; check `review`) and `release-intel` (Grok blockers; check `intel`). Both are required checks, with `test`. See `docs/security/owasp-review.md` and `docs/security/grok-guardrails.md`.
- A human typed security-compliance gate (Security bot's chat) is required for each request. Automated reviews are advisory and never approve.
- Secrets live only in GitHub Actions secrets. This repo uses the exclusive per-agent keys listed in `AGENTS.md`. Each customer repo has its own Grok key, minted per repo and revoked when the repo is archived (`docs/customer-repos.md`).
- Never commit secrets, real customer personal data or production credentials. Use synthetic data in tests and demos.
- Dependabot keeps npm packages and GitHub Actions up to date.

## Supported versions

Only `main` is supported.
