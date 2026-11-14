# Sample release notes (fixture)

Used by the Change Analyst when local git history is unavailable or empty.

## Northwind KYC / Release Desk

- Milestone 1: Northwind Bank KYC demo application with local risk scoring and MOCK-labeled screening notes.
- Milestone 2: Shared run context, audit trail, and agent I/O contracts (`@releasedesk/core`).
- Milestone 3: Lead Agent orchestrator with pluggable specialist runners (`@releasedesk/lead`).
- Milestone 4: Specialist agents — Change Analyst, Standards, Security, Builder — writing independently recorded results.

## Impact focus paths

- `apps/kyc` — customer KYC flows and analyst actions
- `packages/releasedesk-core` — shared contracts
- `packages/releasedesk-lead` — orchestration
- `packages/releasedesk-specialists` — specialist runners
