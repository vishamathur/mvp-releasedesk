# Skill: return-build-result

## When to use

The Cursor cloud agent reports a pull request and a test result.

## Steps

1. Store `proposedBranch`, `prUrl`, `testsPassed`, and `testsSummary` on `pid.build.{requestId}`.
2. Send Lead a teammate message:

```json
{
  "v": 1,
  "kind": "build-result",
  "pid": "PID-ER",
  "pidVersion": "1.0.0",
  "requestId": "REQ-…",
  "from": "builder",
  "to": "lead",
  "stage": "test-gate",
  "action": "return",
  "prUrl": "https://github.com/…",
  "testsPassed": true,
  "testsSummary": "npm run test:desk passed",
  "summary": "Coding agent opened the PR. Tests passed. Release is still a human gate."
}
```

3. Post the same summary on the request thread so the test gate is visible to humans.
4. `consult` Security with the pull request URL so `on-build-diff` can run.

## Must not

- Merge.
- Tell Lead the release is approved.

## Output

A `build-result` Lead uses for the test gate.
