# Handoff protocol v1.1.0

Bots talk to each other with teammate messages. The request thread is Lead's chat with Vishal. Machine shapes live in `handoff.v1.json` and `stage-transition.v1.json`. The message field `v` stays 1.

## Message

```json
{
  "v": 1,
  "kind": "stage-handoff",
  "pid": "PID-ER",
  "pidVersion": "1.1.0",
  "requestId": "REQ-2026-0142",
  "thread": { "channel": "lead-chat", "threadId": "thr_0142" },
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

`kind` is `stage-handoff`, `consult`, `stage-return`, or `build-result`. `intake-request` is not a kind. Public intake reaches Lead as a signed notice and a fetch-back envelope (`docs/intake/lead-integration.md`), not as a handoff. A future Intake-to-Lead teammate message, if one is ever required, has to be a `consult` with `action` `consult`.

`build-result` adds `proposedBranch`, `prUrl`, `testsPassed`, and `testsSummary`. Lead uses that message for the test gate. Builder copies the release-intel result into `testsSummary`.

When the stage owner returns a human decision, `humanGate` is:

```json
{
  "gate": "finance-approval",
  "status": "approved",
  "decidedBy": "Vishal Mathur (Finance partner)",
  "note": "2026-11-22T15:40:00+05:30 | verbatim: APPROVE finance-approval REQ-2026-0142 as Finance partner - ok"
}
```

A bot never decides a gate. The stage owner of a gate stage may send `stage-return` with `humanGate.status` `approved` or `rejected` only when copying a human reply: `decidedBy` is a human name, and `note` is `<ISO-8601 time> | verbatim: <reply>`. Lead rejects anything else.

## Stage transition

Lead appends this to `pid.transitions.{requestId}` and posts it on the thread. Lead also copies it to Release Desk Log.

```json
{
  "requestId": "REQ-2026-0142",
  "pid": "PID-ER",
  "pidVersion": "1.1.0",
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
- One thread per request, opened in Lead's chat (`thread.channel` = `lead-chat`).
- Every bot copies Release Desk Log (priority false) on each message sent or received, each REJECT, and each gate ask or decision. Lead also copies each stage transition. The Log never routes or approves.
- Other bots store their own slice and send it back. They do not advance the stage.
