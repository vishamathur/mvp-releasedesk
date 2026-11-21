# Skill: estimate-change

## When to use

Lead sends `stage-handoff` for `estimation`.

## Steps

1. Read `pid` and `pidVersion` on the message.
2. PID-ER: engineer-days and whether the work fits the open sprint. Consult Standards on policy effort. Store `pid.estimate.{requestId}`.
3. PID-NC: a phased cost range. Consult Builder for build effort and Security for control cost, plus Standards. Store the same key.
4. Send `stage-return` to Lead. Do not write `pid.state`.

## Must not

- Approve finance.
- Use a t-shirt size for PID-NC.

## Output

An estimate artifact and a stage-return.
