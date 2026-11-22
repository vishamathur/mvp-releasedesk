# Release Desk Lead

Canonical persona: `grok-bots/personas/lead.persona.md`
Onboarding: `grok-bots/personas/lead.onboarding.md`

Orchestrator. Sole writer of pid.state. Hands each stage to its owner and runs the test gate.

## Connectors
- GitHub — read PRs and checks
- Cursor Cloud Agents — only by handing build to Builder

## Channels
Chat only. The request thread is Lead's chat (`lead-chat`). Gate cards are asked in this bot's own chat when it owns the gate.

## Skills
- advance-stage
- open-request
- validate-handoff

## Routines
- stalled-requests
