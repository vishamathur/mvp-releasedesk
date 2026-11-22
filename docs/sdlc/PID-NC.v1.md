# PID-NC v1.0.0 — Full product request, new customer

Machine spec: `grok-bots/processes/pid-nc.v1.json`.

A new customer, or an existing customer asking for a product Northwind does not yet run, enters here. Kickoff comes first. The request is not dropped into a sprint that has already locked.

## Entry

Channel `#new-customer`. The card names legal name, jurisdiction, intended product, and an internal sponsor. There is no book-of-record product for this ask.

## Extra stages before the shared tail

These run after intake and before finance:

| Stage | Owner | Consulting | Human approver | SLA | Artifact |
| --- | --- | --- | --- | --- | --- |
| Customer onboarding | Lead | Change Analyst | | 5 business days | Onboarding dossier |
| Discovery | Change Analyst | Standards, Security | | 10 business days | Discovery notes |
| Scope | Change Analyst | Standards | | 5 business days | Scope statement |
| Proposal | Lead | Change Analyst, Standards | Customer sponsor | 5 business days to draft, 10 for the customer | Proposal and customer approval |
| Estimation | Change Analyst | Builder, Security, Standards | | 5 business days after customer approval | Phased estimate with a cost range |

The customer sponsor approves the proposal in `#new-customer`. Lead drafts it. Change Analyst supplies inputs. Standards reviews it. No bot marks it approved.

## Shared tail

| Stage | Owner | Consulting | Human approver | SLA | Artifact |
| --- | --- | --- | --- | --- | --- |
| Intake | Lead | Change Analyst | | 1 business day | Intake card, thread, PID state |
| Finance approval | Lead | Change Analyst | Finance partner | 5 business days | Investment memo decision |
| Security and compliance | Security | Standards, Change Analyst | Security officer or AI red-team lead | 5 business days | Findings, deviations, sign-off request |
| Build | Builder | Security, Standards | | After kickoff names a future sprint | Pull request and kickoff record |
| Test gate | Lead | Builder, Security | | Inside that sprint | Test report |
| Release gate | Lead | Security, Standards, Builder | Release manager | Window agreed at kickoff | Release note, go/no-go |

There is no sprint-envelope shortcut on finance. Security is still mandatory, and the iteration gate is still one human `red_team` or `security` signature.

## Cadence

Lead schedules a kickoff before build. Discovery is not boxed to the enhancement sprint. Release uses the window agreed at kickoff, not the PID-ER Thursday train.

## Difference from PID-ER

PID-NC adds onboarding, discovery, scope, a customer-approved proposal, and a heavier phased estimate before finance. Approvers include the customer sponsor. SLAs are longer. The request waits for kickoff instead of joining the fixed sprint.
