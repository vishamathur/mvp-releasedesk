# Working agreement

## Cadence
- **Sprint length:** 2 weeks, Monday to Friday of the following week.
- **Sprint planning:** first Monday, 60 minutes. Only stories that meet the [Definition of Ready](./DEFINITION_OF_READY.md) enter.
- **Daily stand-up:** 15 minutes, async in the request thread is fine: done, next, blocked.
- **Backlog refinement:** mid-sprint Wednesday, 45 minutes.
- **Sprint review / demo:** last Friday, 30 minutes. Demo against acceptance criteria.
- **Retrospective:** last Friday, 30 minutes. One improvement goes into the next sprint.

## Flow and WIP limits
- **In progress:** at most 2 stories per person (or per coding agent), 3 per repo.
- **In review:** at most 3 open pull requests per repo. Clear review findings before starting new work.
- Stop starting, start finishing. A blocked item gets `status:blocked` and is raised the same day.

## Review SLA
- Review is automated: the Grok release-intel and OWASP review checks run on every push. There are no human GitHub approvals.
- The author (or Builder's coding agent) fixes or explains every reported blocker or failure within **1 business day**.
- An OWASP exception that needs a human is answered within **1 business day**.
- Human gate asks (finance, security, release) are answered within **2 business days**, or the request is re-planned.
- A red `main` is fixed or reverted within **4 working hours**.

## Ways of working
- Trunk-based: short-lived branches, small PRs, `main` always releasable.
- The Grok and OWASP checks are the review; they never approve a merge or a release. Vishal owns every typed gate and every merge.
- Decisions and gate answers are written down in the request thread and the Release Desk log.
- Times are in IST (Asia/Kolkata).
