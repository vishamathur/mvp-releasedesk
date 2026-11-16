# Skill: start-release-check

1. Confirm goal + repository (default `vishamathur/mvp-releasedesk`).
2. If intake is enabled, refuse unless item is `approved_for_dev` (both cost + queue approvals).
3. Create run context; post runId to `#release-desk`.
4. Invoke skills on Change Analyst, Standards, and Security **in parallel**.
5. Collect results; if remediation recommended, hand off to Builder with explicit goals.
6. After checkpoints / iteration gate (`evaluateIterationProceedGate`), request human merge + release approvals.
7. Never mark ready until both gates approved and no Security / ATLAS-OWASP blockers.
