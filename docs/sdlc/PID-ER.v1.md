# PID-ER v1.0.0 — Enhancement request, existing customer

Machine spec: `grok-bots/processes/pid-er.v1.json`.

A known customer asks for a change to a product Northwind already runs. The work joins a fixed sprint. Lead does not run onboarding, discovery, a scope workshop, or a customer proposal.

## Entry

Channel `#er-intake`. The customer id and product id already exist. The ask is an enhancement, a defect, or a regulatory tweak. No severity-1 incident is open on that product.

## Cadence

Two-week sprint. Planning is every other Monday at 09:00 America/New_York. The release window is Thursday of week 2 at 15:00 America/New_York. There is no kickoff. Work that misses planning lock waits for the next sprint.

## Stages and SLAs

| Stage | Owner | Consulting | Human approver | SLA | Artifact |
| --- | --- | --- | --- | --- | --- |
| Intake | Lead | Change Analyst | | 4 business hours | Intake card, thread, PID state |
| Estimation | Change Analyst | Standards | | 2 business days, before planning lock | Engineer-days and sprint fit |
| Finance approval | Lead | Change Analyst | Finance partner | 2 business days | Sprint-envelope decision |
| Security and compliance | Security | Standards, Change Analyst | Security officer or AI red-team lead | 3 business days | Findings, deviations, sign-off request |
| Build | Builder | Security, Standards | | Inside the sprint | Pull request |
| Test gate | Lead | Builder, Security | | Before the release window | Test report |
| Release gate | Lead | Security, Standards, Builder | Release manager | Thursday week 2, 15:00 America/New_York | Release note, go/no-go |

Finance approval is required on every enhancement, including work inside the sprint envelope. Security is mandatory. One human signature of kind `red_team` or `security` opens the iteration gate. Bots do not sign, and they do not auto-approve.

## Difference from PID-NC

PID-ER has no customer onboarding, discovery, scope, or proposal. The estimate is sprint-sized, not a phased cost range. Finance is a sprint envelope with a 2-day SLA, not an investment memo. The clock is the sprint train, not a kickoff. The only human approvers are Finance partner, Security officer or AI red-team lead, and Release manager.
