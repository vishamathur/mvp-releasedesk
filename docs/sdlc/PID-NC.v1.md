# PID-NC v1.1.0 — Full product request, new customer

Machine spec: `grok-bots/processes/pid-nc.v1.json`. The filename keeps the v1 stem. The content is version 1.1.0.

A new customer, or an existing customer asking for a product Northwind does not yet run, enters here. Kickoff comes first. The request is not dropped into a sprint that has already locked.

## Entry

Channel `lead-chat`. Started in Lead's chat with the intake card. The card names legal name, jurisdiction, intended product, and an internal sponsor. There is no book-of-record product for this ask.

## Extra stages before the shared tail

These run after intake and before finance:

| Stage | Owner | Consulting | Human approver | SLA | Artifact |
| --- | --- | --- | --- | --- | --- |
| Customer onboarding | Lead | Change Analyst | | 5 business days | Onboarding dossier |
| Discovery | Change Analyst | Standards, Security | | 10 business days | Discovery notes |
| Scope | Change Analyst | Standards | | 5 business days | Scope statement |
| Proposal | Change Analyst | Standards | Customer sponsor | 5 business days to draft, 10 for the customer | Proposal and customer approval |
| Estimation | Change Analyst | Builder, Security, Standards | | 5 business days after customer approval | Phased estimate with a cost range |

Change Analyst raises the proposal gate and asks the customer sponsor in its own chat. Standards reviews the proposal. No bot marks it approved without that reply.

## Shared tail

| Stage | Owner | Consulting | Human approver | SLA | Artifact |
| --- | --- | --- | --- | --- | --- |
| Intake | Lead | Change Analyst | | 1 business day | Intake card, thread, PID state |
| Finance approval | Change Analyst | | Finance partner | 5 business days | Investment memo decision |
| Security and compliance | Security | Standards, Change Analyst | Security officer or AI red-team lead | 5 business days | Findings, deviations, sign-off request |
| Build | Builder | Security, Standards | | After kickoff names a future sprint | Pull request and kickoff record |
| Test gate | Lead | Builder, Security | | Inside that sprint | Test report |
| Release gate | Builder | Security, Standards | Release manager | Window agreed at kickoff | Release note, go/no-go |

There is no sprint-envelope shortcut on finance. Security is still mandatory, and the iteration gate is still one human `red_team` or `security` signature.

## Human gates

| Gate | Approver role | Raising bot |
| --- | --- | --- |
| proposal | Customer sponsor | Change Analyst |
| finance-approval | Finance partner | Change Analyst |
| security-compliance-approval | Security officer or AI red-team lead | Security |
| release-gate | Release manager | Builder |

## Channels: chat only

`entry.channel` is `lead-chat`. The same Lead chat is the request thread. The `pid` field tells PID-NC apart from PID-ER. Gate cards are asked in the owning bot's chat.

## Audit log

`auditLog.bot` is Release Desk Log, agent `3824a7e2-512f-4a5b-a0bd-5202fd8dffbd`. Lines are appended under `RELEASEDESK_LOG_DIR`. The Log never routes or approves.

## Cadence

Lead schedules a kickoff before build and writes `pid.kickoff.{requestId}` naming a future sprint. Discovery is not boxed to the enhancement sprint. Release uses the window agreed at kickoff, not the PID-ER Thursday train.
