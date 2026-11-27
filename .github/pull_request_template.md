## Request

- Release Desk request: `REQ-____-____` <!-- required -->
- Type: <!-- PID-ER enhancement / PID-NC new product / bug -->
- Linked issue: #

## What and why

<!-- One or two sentences. Keep the PR small: one request or story. -->

## Acceptance criteria

<!-- Copy from the story. Tick each one that this PR meets. -->
- [ ] Given … When … Then …
- [ ] Given … When … Then …

## Definition of Done

- [ ] Acceptance criteria met and demoed
- [ ] Tests added or updated; `npm test`, lint and typecheck pass locally
- [ ] `test` (ci), `intel` (release-intel) and `review` (owasp-review) checks green
- [ ] No secrets, real personal data or production credentials committed
- [ ] Docs, `.env.example` and `CHANGELOG.md` updated where relevant
- [ ] MOCK / EXAMPLE DATA labels kept on deliberate demo integrations
- [ ] One human review approved

## Test evidence

<!-- Paste test output, screenshots or check links. -->

```
npm test
```

## Security notes

<!-- Data touched (PII?), auth or access changes, new dependencies, OWASP findings and how they were closed. Write "none" if none. -->

## Release

- [ ] Release gate requested from Builder (Vishal decides). Never auto-merge.
