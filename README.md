# mvp-releasedesk

**Release Desk** is a chat-run SDLC harness. Grok Bot teammates (Intake, Lead, Change Analyst, Standards, Security, Builder, plus Release Desk Log) move each request through human gates. Builder's Cursor cloud agent writes the code. Grok reviews every pull request.

**North Star:** Any customer, any project which is required should be able to run through this SDLC lifecycle.

## SDLC flow

1. **Intake.** Lead opens the request (PID-ER enhancement or PID-NC new product).
2. **Finance approval.** Change Analyst estimates, then Vishal types the decision.
3. **Repo from template.** A private customer repo is created from [releasedesk-customer-template](https://github.com/vishamathur/releasedesk-customer-template), with its own Grok key.
4. **Security gate.** Security reviews the scope, then Vishal types the decision.
5. **Build.** Builder's cloud agent opens a PR in the customer repo. CI, Grok release-intel and the OWASP review run on it.
6. **Release gate.** Vishal types the decision and merges by hand. Nothing auto-merges.
7. **Rejected requests.** The repo is archived and its Grok key revoked.

## Rules

- **Repo names:** `<customer>-ER` or `<customer>-<request>`, for example `acme-ER` or `acme-kyc-occupation`.
- **One Grok key per customer repo**, stored as the `RELEASEDESK_GROK_API_KEY_LEAD` secret.
- **Reviews are Grok only.** The required checks are Grok release-intel and the OWASP review. GitHub needs no human approvals, and Grok never approves a merge or a release.
- **No extra cost.** Private repos on GitHub Free get no branch protection, so the Release Desk gates (security-compliance and release) enforce the rules there.
- **No mocks, no fallbacks.** A missing key fails the check. Demo integrations keep their labels (below).

## Quick start

Requires Node.js 20+.

```bash
npm install
npm test                 # all workspaces
npm run dev              # KYC demo on :3000
npm run build:core && npm run build:lead && npm run desk   # Desk on :3002 (/handoff)
```

## Layout

| Path | What |
| --- | --- |
| `grok-bots/` | Bot personas and skills |
| `packages/releasedesk-core` | Run context, contracts, OWASP review, customer-repo setup |
| `packages/releasedesk-lead` | Lead orchestrator, verification, PR workflow |
| `packages/releasedesk-specialists` | Specialists and Builder's cloud-agent dispatch |
| `apps/releasedesk` | Desk UI (read-only Log trace) and Grok release-intel |
| `apps/kyc` | Northwind Bank KYC demo app (moving to its customer repo) |

## Demo labels

- **KYC (`apps/kyc`)** labels these integrations **MOCK** in the UI and API: document storage and OCR (metadata and a fabricated summary), identity and liveness (placeholder), and sanctions/PEP screening (local rules, `MOCK:` notes).
- **Intake site (`apps/intake`)** labels its catalogue **EXAMPLE DATA**.

## Docs

- [SDLC overview](./docs/sdlc/overview.md) · [PID-ER](./docs/sdlc/PID-ER.v1.md) · [PID-NC](./docs/sdlc/PID-NC.v1.md) · [Demo script](./docs/sdlc/demo-script.md)
- [Customer intake](./docs/customer-intake.md) · Customer repos: `docs/customer-repos.md` (PR #50)
- [Release-intel report](./docs/grok-release-intel-report.md) · [OWASP review](./docs/security/owasp-review.md) · [Grok guardrails](./docs/security/grok-guardrails.md)
- [Contributing](./CONTRIBUTING.md) · [Definition of Ready](./docs/DEFINITION_OF_READY.md) · [Definition of Done](./docs/DEFINITION_OF_DONE.md) · [Working agreement](./docs/WORKING_AGREEMENT.md) · [Security](./SECURITY.md)
- [Agent rules](./AGENTS.md) · [Bot pack](./grok-bots/README.md)

License: [GPL-3.0](./LICENSE).
