# Skill: record-stage-transition

## When to use

A teammate sends `stage-return` or `build-result`, or a human replies on a pending gate.

## Steps

1. Append one record to `pid.transitions.{requestId}` using `grok-bots/protocols/stage-transition.v1.json`.
2. Update `pid.state.{requestId}` to the new stage. You are the only bot that writes this key.
3. Post the record on the request thread.
4. If the next stage has a human approver, run `request-human-gate` and do not message a bot to approve it.
5. Otherwise send `stage-handoff` to the owner in the process spec.
6. On `rejected`, set status `blocked` and do not hand off.

## Must not

- Skip the security and compliance stage.
- Let another bot overwrite `pid.state`.

## Output

Updated memory and a thread post.
