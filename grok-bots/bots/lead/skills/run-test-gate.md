# Skill: run-test-gate

## When to use

Builder sends `kind: build-result`.

## Steps

1. Read `testsPassed`, `prUrl`, and `testsSummary` from the message. Store nothing that looks like a secret.
2. Post the result on the request thread.
3. If `testsPassed` is false, send Lead → Builder `stage-handoff` with `action: remediate` and the failure summary.
4. If the summary names a new security finding, `consult` Security before the release gate.
5. If tests passed and `pid.decisions` already contains a human security/compliance approval, run `request-human-gate` for the release gate.

## Must not

- Mark the release approved because tests passed.
- Merge the pull request.

## Output

A test-gate record, then either remediation or a pending release card.
