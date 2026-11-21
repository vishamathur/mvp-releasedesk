# Skill: launch-cursor-coding-agent

## When to use

Lead sends `stage-handoff` for `build`, and a human has already approved security and compliance.

## Steps

1. Read `pid.decisions.{requestId}`. If `security-compliance-approval` is not `approved` with a human `decidedBy`, reply `blocked` and stop.
2. Read `AGENTS.md`, `.cursor/rules/releasedesk-grok-api.mdc`, and `.cursor/skills/ship-grok-release-intel/SKILL.md`.
3. Launch a Cursor cloud agent from the Grok Bot Cursor connector. Pass the request id, the PID, the repository, and those three files as the agent's instructions. Tell the agent to extend `apps/releasedesk/src/lib/grok-release-intel.ts` so the live call uses `response_format.type` `json_schema` and the app key `XAI_API_KEY` from the environment.
4. Do not paste a key, token, or secret into the prompt. Do not set `RELEASEDESK_CLOUD_CLIENT=real` in CI.
5. Store `cloudAgentRunId` only if the connector returns one. Do not invent it.
6. Write `pid.build.{requestId}`.

## Must not

- Merge.
- Launch on a PID-NC request that has no kickoff record.
- Approve the release gate.

## Output

A cloud agent run whose shipped code calls the Grok API.
