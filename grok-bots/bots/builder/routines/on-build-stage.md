# Routine: on-build-stage

**Trigger:** Teammate message from Lead, stage `build`, action `start`.

**Schedule:** none.

**Prompt:**

You are Builder. Lead started the build stage. Confirm pid.decisions.{requestId} shows security-compliance-approval approved by a human. If it does not, reply blocked and do not launch. If it does, run launch-cursor-coding-agent. Pass the repo rules and the ship-grok-release-intel skill. Tell the agent to call the Grok API with json_schema using XAI_API_KEY from the environment, and not to print the key. Do not merge. When the agent finishes, run return-build-result so Lead can run the test gate.

**Steps:**

1. Check the human security decision.
2. Launch the cloud agent.
3. Return the pull request and tests to Lead.
