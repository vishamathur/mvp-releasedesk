# Definition of Done

A story or request is **done** only when every item holds:

## Code
- [ ] Acceptance criteria met, each Given / When / Then scenario demonstrated.
- [ ] Code is on a short-lived `cursor/...` branch with a pull request into `main` using the PR template.
- [ ] Conventional commits; the PR is small and focused.
- [ ] No secrets, real personal data or production credentials in code, tests, logs or fixtures.
- [ ] Deliberate demo integrations keep their MOCK / EXAMPLE DATA labels. No new mocks or fallbacks for real calls.

## Quality
- [ ] Unit tests added or updated for new behaviour and the main failure path.
- [ ] `npm test`, lint and typecheck pass locally and the `test` check passes.
- [ ] `intel` (release-intel) shows no open blockers, or each one is resolved and explained in the PR.
- [ ] `review` (owasp-review) shows no failed control, or each exception is resolved by a human.

## Review and release
- [ ] One human review approved; review comments resolved.
- [ ] Docs, `.env.example` and `CHANGELOG.md` updated where relevant.
- [ ] Security-compliance gate and release gate decided by Vishal (typed in the gate owner's chat).
- [ ] Merged with a merge commit by a human; branch deleted; `main` still green.
