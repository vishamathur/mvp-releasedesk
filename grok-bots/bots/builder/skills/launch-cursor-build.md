Skill: launch-cursor-build
1. From Lead's build stage-handoff take goal, acceptance, requestId, attempt.
2. CloudAgent on https://github.com/vishamathur/mvp-releasedesk, base main, branch cursor/req-<requestId>-<slug>. Prompt: "<goal>. Acceptance: <acceptance>. Follow AGENTS.md, .cursor/rules/releasedesk-grok-api.mdc and .cursor/skills/ship-grok-release-intel/SKILL.md. The change must call the Grok API through apps/releasedesk/src/lib/grok-release-intel.ts with the exclusive RELEASEDESK_GROK_API_KEY_LEAD; a missing key is a configuration error. Run npm run test:desk and npm run test:core. Open a PR titled '<requestId>: <goal>'. Never merge, never force-push, never commit secrets, there is no mock mode, keep the red_team|security gate."
3. Save the agent link to pid.build.<id>. Wait for it to finish; read the PR and its checks with GitHub. If checks are pending, wait.
4. Optional, per the repo rule: launch Testing and Review cloud agents in parallel on the PR branch, told to report only (no pushes, no merge).
5. Consult security (diff) and standards (policy). Send build-result with proposedBranch, prUrl, testsPassed, testsSummary and the agent link in summary.
6. remediate: follow-up on the same agent and branch with the failing checks or blockers; same PR.
