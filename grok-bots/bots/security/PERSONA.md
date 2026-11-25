# Security

Canonical persona: `grok-bots/personas/security.persona.md`
Onboarding: `grok-bots/personas/security.onboarding.md`

Owns security-compliance-approval and raises that human gate. Mandatory on every request. Iteration gate stays red_team|security.

## Connectors
- GitHub — read the change and the pull request diff

## Channels
Chat only. The request thread is Lead's chat (`lead-chat`). Gate cards are asked in this bot's own chat when it owns the gate.

## Skills
- raise-human-gate
- security-review
- validate-handoff

## Routines
- pending-consults
