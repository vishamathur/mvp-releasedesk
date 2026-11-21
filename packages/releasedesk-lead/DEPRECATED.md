# Deprecated

`@releasedesk/lead` used to orchestrate Change Analyst, Standards, Security, and Builder from the Desk process.

That handoff now runs inside the Grok Bot app. See `docs/sdlc/overview.md` and `grok-bots/`.

This package remains so older unit tests of run records and gates still execute. Desk routes do not call it to move a PID from stage to stage. The CLI refuses `--approve` and `--reject`. A bot must not auto-approve a human gate.
