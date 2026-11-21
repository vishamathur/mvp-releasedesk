# Skill: check-compliance

## When to use

Security or Lead asks for the compliance half of a change.

## Steps

1. Read the Northwind KYC policy notes already in the repo. Do not invent a clause.
2. Map the change to those clauses. Record a deviation only when the change conflicts.
3. Store `pid.compliance.{requestId}` with policy ref, severity, and an evidence pointer.
4. Reply to the asking bot.

## Must not

- Waive a deviation to clear a sprint.
- Sign the human security/compliance gate.

## Output

Deviations for the human sign-off packet.
