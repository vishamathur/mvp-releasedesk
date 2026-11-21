# Skill: security-review

## When to use

Every request, at security and compliance approval, and again when a build diff or a test result appears. There is no low-risk skip.

## Steps

1. Review the change packet or the diff.
2. Ask Standards for `pid.compliance.{requestId}`.
3. Store `pid.security.findings.{requestId}` with severity and whether each finding blocks release.
4. Send `stage-return` to Lead with `humanGate.status` `pending`.

## Must not

- Skip the review because the estimate is small.
- Set the gate to approved.
- Advance `pid.state`.

## Output

Findings and a pending human gate. The iteration rule stays `red_team|security`: one human signature of either kind.
