# Routine: on-demand-release

**Trigger:** Human says “start release check” in `#release-desk` or Desk `POST /api/bots/trigger`.

**Steps:** Run skill `start-release-check`. Post intermediate handoffs. Pause for human approvals. Resume only after approve/reject recorded.
