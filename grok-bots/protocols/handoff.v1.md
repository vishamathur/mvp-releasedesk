# Handoff protocol v1.0.0

Bots talk to each other with teammate messages. Humans see the same facts on the request thread. Machine shapes live in `handoff.v1.json` and `stage-transition.v1.json`.

## Message

```json
{
  "v": 1,
  "kind": "stage-handoff",
  "pid": "PID-ER",
  "pidVersion": "1.0.0",
  "requestId": "REQ-2026-0142",
  "thread": { "channel": "#er-intake", "threadId": "thr_0142" },
  "from": "lead",
  "to": "change-analyst",
  "stage": "estimation",
  "action": "start",
  "summary": "Existing customer NORTHWIND-014, KYC address refresh. Need engineer-days and sprint fit.",
  "artifactRefs": ["memory:pid.customer.REQ-2026-0142"],
  "memoryKey": "pid.state.REQ-2026-0142",
  "humanGate": null
}
```

`kind` is `stage-handoff`, `consult`, `stage-return`, or `build-result`.

`build-result` adds `proposedBranch`, `prUrl`, `testsPassed`, and `testsSummary`. Lead uses that message for the test gate.

When a human gate is open, `humanGate` is:

```json
{ "gate": "finance-approval", "status": "pending", "decidedBy": null, "note": "Sprint envelope, 3 engineer-days" }
```

A bot may set `status` to `pending`. Only a human reply may set `approved` or `rejected`, and `decidedBy` is that person's name.

## Stage transition

Lead appends this to `pid.transitions.{requestId}` and posts it on the thread:

```json
{
  "requestId": "REQ-2026-0142",
  "pid": "PID-ER",
  "pidVersion": "1.0.0",
  "fromStage": "estimation",
  "toStage": "finance-approval",
  "at": "2026-11-21T15:00:00Z",
  "actor": "lead",
  "reason": "Change Analyst returned a 3 engineer-day estimate",
  "humanDecision": null
}
```

## State

- Lead memory `pid.state.{requestId}` is the only stage pointer.
- One thread per request, opened in `#er-intake` (PID-ER) or `#new-customer` (PID-NC).
- Lead mirrors human gate cards to `#release-desk`.
- Other bots store their own slice and send it back. They do not advance the stage.
