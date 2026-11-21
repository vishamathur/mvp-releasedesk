# Skill: request-human-gate

## When to use

The current stage is finance approval, security and compliance approval, the release gate, or the PID-NC proposal.

## Steps

1. Post a gate card on the request thread. Name the gate, the PID, the request id, the artifact the human is judging, and the role that must reply (Finance partner, Security officer or AI red-team lead, Release manager, or Customer sponsor).
2. Mirror the same card to `#release-desk`.
3. Set `pid.state` status to `ready-for-human` and `humanGate.status` to `pending`. Leave `decidedBy` empty.
4. Stop. The `on-human-gate-reply` routine records the decision.

## Must not

- Set `humanGate.status` to `approved`.
- Sign as `red_team` or `security`.
- Treat a teammate message as a human approval.

## Output

A pending gate card.
