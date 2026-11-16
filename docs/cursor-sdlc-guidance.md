# Cursor official guidance — automated SDLC (lookup)

Last updated: 2026-11-17 (Asia/Calcutta)

Sources: [Cloud Agent best practices](https://cursor.com/docs/cloud-agent/best-practices), [Cloud environment setup](https://cursor.com/docs/cloud-agent/setup), [Automations](https://cursor.com/docs/cloud-agent/automations), [CLI in GitHub Actions](https://cursor.com/docs/cli/github-actions), [Dev environments blog](https://cursor.com/blog/cloud-agent-development-environments).

## Summary of recommendations

1. **Locally testable repos** — Agents need the same ability as humans to run and debug locally; avoid hard dependencies on unreachable external services.
2. **Secrets + egress** — Provide secrets via dashboard; whitelist required network destinations; prefer OIDC over long-lived keys for cloud roles.
3. **Environment snapshots** — Put installable deps/codegen/fixtures in install scripts; keep long-running services (DB, docker, servers) in startup; commit `.cursor/environment.json`.
4. **Context via AGENTS.md + skills** — Document how to run/debug services and when to use each skill so agents can test changes effectively.
5. **Tools / MCP** — Give agents the same systems humans use; iterate tooling so models use it reliably.
6. **Automations** — Event-driven or scheduled Cloud Agents (PR opened/pushed, CI completed, webhooks) for review, triage, and follow-ups.
7. **CI with Cursor CLI** — Prefer **restricted autonomy**: agent edits files; commits, pushes, and PR comments stay deterministic in workflow steps; use permission allow/deny lists.

## Release Desk — Testing vs Verification (human note)

Release Desk models two **distinct** post-Coding stages (see [`architecture-mermaid.md`](./architecture-mermaid.md)):

| Stage | Who | Meaning |
| --- | --- | --- |
| **Testing** | Testing Cloud Agent | Automated test execution; records `testsPassed` + evidence. Own box in the SDLC. |
| **Verification** | Lead / independent check | Consumes Testing evidence and judges build quality. **Must not auto-pass** just because Testing ran or completed. |

Order after Builder / ATLAS / Coding:

`Coding → Testing → Verification → Checkpoints + remediate → feature checklist → merge → release`

When operating Cloud Agents or reviewing a run:

1. Confirm the Testing stage has its own status/evidence (not only a Builder footnote).
2. Confirm Verification has an **independent** pass/fail — failing or missing `testsPassed=true` must fail Verification.
3. Do not collapse Verification into checkpoint remediation or into “tests ran.”
4. No Zscaler subscription is required for local MVP (optional `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` stays MOCK without credentials).

## On-demand Desk → Lead (no scheduler)

Release Desk UI + KYC are the **always-on** served layer. Lead (and specialists) are **request-scoped**:

1. Dual human intake approvals must clear (`approved_for_dev`) — see [`customer-intake.md`](./customer-intake.md).
2. An operator (or Automation) starts Lead **on demand** via Desk `POST /api/checks`, intake “start Lead”, or CLI `check:release` / `check:release:stubs`.
3. There is **no** background process that polls the backlog queue and auto-starts Lead.

Cursor-maximized target: Lead/specialists/AI Red Teaming become ephemeral Cloud Agents; Coding/Testing/Review already are. Mermaid updates for that layout are owned by the Cursor-maximized architecture PR — see [`architecture-mermaid.md`](./architecture-mermaid.md).

## How this maps to Cursor Cloud Agents

- Keep the repo **locally runnable** (`npm test`, seed, desk UI) so Testing Cloud Agents can execute the same suites humans use.
- Prefer MOCK Cloud Agent clients in CI; enable real Coding/Testing/Review only when `CURSOR_API_KEY` (or service account) is present.
- Use Automations for PR/CI follow-ups and optional Desk→Lead triggers; keep merge/release as human gates in Release Desk (never auto-merge).
- Do not run an always-on Lead daemon — on-demand only.
