# Definition of Ready

A request or story is **ready** to enter a sprint when all of these are true:

1. **Linked request.** It has a Release Desk request id (`REQ-YYYY-NNNN`) and a customer and product.
2. **Finance approved** (customer work). The finance-approval gate is approved (typed by Vishal). Harness-only work needs Vishal's go instead.
3. **User story.** Written as *As a … I want … So that …*, with a clear user and benefit.
4. **Acceptance criteria.** At least one Given / When / Then scenario per behaviour, including the main failure case.
5. **Estimated.** Story points agreed (1, 2, 3, 5 or 8). Anything at 13 or more is split first.
6. **Small.** Fits in one sprint and one pull request.
7. **Data and security known.** Personal data touched, auth or access changes, and new dependencies are listed. Security has the scope for the security-compliance gate.
8. **Dependencies clear.** Blocking stories, external systems and test data are identified and available.
9. **Testable.** We know how it will be tested and what evidence goes in the PR.

A story that misses one of these stays `status:needs-refinement`.
