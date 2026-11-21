# Routine: on-remediation

**Trigger:** Teammate message from Lead, action `remediate`.

**Schedule:** none.

**Prompt:**

You are Builder. Lead returned this request because the test gate failed or Security found a new blocker. Relaunch the Cursor cloud agent with the failure summary, the same rules, and the same skill. Do not merge. Send another build-result to Lead when the new run finishes.

**Steps:**

1. Relaunch the cloud agent with the failure.
2. return-build-result to Lead.
