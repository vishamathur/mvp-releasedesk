# SpaceXAI Grok Bots — Lead + specialists

Roster: **Release Desk Lead**, **Change Analyst**, **Standards**, **Security**, **Builder**.

The workflow runs in the Grok Bot app. Desk does not hand stages from bot to bot, and bots do not have API keys.

## Processes

| PID | Spec | Who | Cadence | Channel |
| --- | --- | --- | --- | --- |
| PID-ER v1.0.0 | `processes/pid-er.v1.json` | Existing customer enhancement | Fixed two-week sprint | `#er-intake` |
| PID-NC v1.0.0 | `processes/pid-nc.v1.json` | New customer product request | Kickoff first | `#new-customer` |

Customers submit at `intake.vishalmathur.org` (`apps/intake`). That PHP app hands an intake card to Lead. Human gates (finance, security/compliance, release, and the PID-NC proposal) are answered by a person in the request thread. Overview and diagrams: `docs/sdlc/overview.md`.

Handoff message and stage-transition record: `protocols/handoff.v1.md`.

## Where the bots live

The five bots were created in the **Grok Bot app** on 2026-11-18 as teammates. They are not xAI Agents API resources.

| Bot | App name | Grok Bot app agent id |
| --- | --- | --- |
| Lead | Release Desk Lead | `46e50097-0409-4972-9be0-6ade37563135` |
| Change Analyst | Change Analyst | `d68fd46b-cffd-4f58-883e-1a75657ccb99` |
| Standards | Standards | `a82edff2-7d5d-47f2-b8bf-fb4f503177f1` |
| Security | Security | `c325bdd3-28df-419e-9824-4ede1338afc9` |
| Builder | Builder | `c932bf04-d05e-4809-a5cc-64afa9fb0894` |

`liveBotId` stays null. `npm run create:grok-bots` preserves these rows and does not POST them to `https://api.x.ai`.

## What each bot is configured with

Definitions: `definitions/*.json`. Playbooks: `bots/<id>/skills/*.md` and `bots/<id>/routines/*.md`.

| Bot | Skills | Routines |
| --- | --- | --- |
| Lead | route-intake, request-human-gate, record-stage-transition, run-test-gate | on-er-intake, on-nc-intake, er-sprint-cadence (every other Monday 09:00 America/New_York), on-human-gate-reply, on-builder-result |
| Change Analyst | estimate-change, discover-and-scope, proposal-inputs | on-estimation-handoff, on-nc-discovery, er-sprint-planning-consult (every other Monday 10:00 America/New_York) |
| Standards | check-compliance, review-proposal | on-change-packet, on-compliance-consult |
| Security | security-review, prepare-signoff-request | mandatory-every-change, on-build-diff |
| Builder | launch-cursor-coding-agent, return-build-result | on-build-stage, on-remediation |

Channels: `#er-intake`, `#new-customer`, `#release-desk`. Who posts and who listens is on each definition.

Builder's `on-build-stage` routine launches a Cursor cloud agent using `.cursor/rules/releasedesk-grok-api.mdc` and `.cursor/skills/ship-grok-release-intel/SKILL.md`. The pull request and test result go back to Lead as a `build-result` teammate message.

## App key

Shipped Grok calls use `XAI_API_KEY` only. Never commit it. Bots do not read it. Per-bot `RELEASEDESK_*` keys are ignored. Do not set `RELEASEDESK_CLOUD_CLIENT=real`.

## create:grok-bots

```bash
npm run create:grok-bots -- --dry-run
npm run create:grok-bots
```

Both leave the five app teammates in place. Neither command creates bots through the xAI Agents API.
