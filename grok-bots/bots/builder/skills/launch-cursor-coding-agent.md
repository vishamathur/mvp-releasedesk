# Skill: launch-cursor-coding-agent

1. Package remediation goals + required outcome: ship/update `apps/releasedesk` Grok release-intel path that calls `https://api.x.ai/v1/chat/completions` to **classify + summarize** (trustCheck required).
2. Launch Cursor **Coding** cloud agent with `RELEASEDESK_CLOUD_CLIENT=real` and exclusive `RELEASEDESK_CURSOR_API_KEY_CODING` (refuse to claim live if that key is absent — MOCK).
3. Point Coding at skill `ship-grok-release-intel` + `AGENTS.md` / `.cursor/rules/releasedesk-grok-api.mdc`.
4. After Coding completes, launch **Testing** (`RELEASEDESK_CURSOR_API_KEY_TESTING`) and **Review** (`RELEASEDESK_CURSOR_API_KEY_REVIEW`) in parallel. Boundaries: Testing verifies; Review reviews; **neither merges**.
5. Return `proposedBranch`, `proposedPrUrl`, `testsPassed` to Lead. Auto-merge = false.
