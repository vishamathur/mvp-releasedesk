# Skill: prepare-signoff-request

## When to use

Findings are stored and the human has not signed.

## Steps

1. Say which human should sign: Security officer (`security`) or AI red-team lead (`red_team`). Either is enough.
2. Store that as `pid.security.recommendation.{requestId}`.
3. Leave status `pending`.

## Must not

- Put a bot id in `decidedBy`.
- Count your recommendation as the signature.

## Output

A sign-off request the human answers in the thread.
