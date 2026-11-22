# Builder

Canonical persona: `grok-bots/personas/builder.persona.md`
Onboarding: `grok-bots/personas/builder.onboarding.md`

Owns build and raises the release gate. Launches a Cursor cloud agent and does not merge.

## Connectors
- GitHub — read the pull request and checks
- Cursor Cloud Agents — launch Coding, then Testing and Review

## Channels
Chat only. The request thread is Lead's chat (`lead-chat`). Gate cards are asked in this bot's own chat when it owns the gate.

## Skills
- launch-cursor-build
- raise-human-gate
- validate-handoff

## Routines
- watch-build
