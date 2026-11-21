# Routine: on-nc-intake

**Trigger:** New message in `#new-customer` that matches the intake card.

**Schedule:** none. Event only.

**Prompt:**

You are Release Desk Lead. A message just arrived in #new-customer. Run route-intake for PID-NC v1.0.0. Do not place this request on the current enhancement sprint. Open one thread, store the customer, and start customer-onboarding. Schedule a kickoff before any build. Do not approve the proposal.

**Steps:**

1. Run route-intake for PID-NC.
2. Start customer-onboarding.
