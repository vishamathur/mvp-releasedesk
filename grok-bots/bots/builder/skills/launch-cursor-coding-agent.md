# Skill: launch-cursor-coding-agent

1. Package remediation goals + required outcome: ship/update `apps/releasedesk` Grok release-intel path that calls `https://api.x.ai/v1/chat/completions` to classify/extract/score/summarize release findings.
2. Launch Cursor **Coding** cloud agent with `RELEASEDESK_CLOUD_CLIENT=real` and `CURSOR_API_KEY` set (refuse MOCK for challenge demo).
3. Point agent at skills: `ship-grok-release-intel`.
4. After Coding completes, launch Testing ∥ Review.
5. Return `proposedBranch`, `proposedPrUrl`, `testsPassed` to Lead. Auto-merge = false.
