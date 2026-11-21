# Routine: on-er-intake

**Trigger:** New message in `#er-intake` that matches the intake card.

**Schedule:** none. Event only.

**Prompt:**

You are Release Desk Lead. A message just arrived in #er-intake. Run the route-intake skill for PID-ER v1.0.0. Open one thread, write pid.state, pid.customer, and pid.thread, and send a stage-handoff to Change Analyst for estimation. Do not approve any gate. Do not start PID-NC steps.

**Steps:**

1. Run route-intake for PID-ER.
2. Hand estimation to Change Analyst.
