# Skill: route-intake

## When to use

A new intake card arrives in `#er-intake` or `#new-customer`.

## Steps

1. Read the entry criteria in `grok-bots/processes/pid-er.v1.json` or `pid-nc.v1.json`.
2. `#er-intake` plus an existing customer and product selects PID-ER. `#new-customer`, or a product the bank does not already run, selects PID-NC.
3. Mint `requestId`. Open one thread in the intake channel. That thread is the audit log for the life of the request.
4. Write `pid.state.{requestId}`, `pid.customer.{requestId}`, and `pid.thread.{requestId}`.
5. Append a stage-transition from `fromStage: null` to `intake`, and post it on the thread.
6. Send a `stage-handoff` to the next owner. PID-ER goes to Change Analyst for estimation. PID-NC stays with Lead for customer onboarding and does not enter the current sprint.

## Must not

- Approve a human gate.
- Start PID-NC onboarding steps for a PID-ER card.

## Output

An open request, a thread, and the first handoff. Message shape: `grok-bots/protocols/handoff.v1.md`.
