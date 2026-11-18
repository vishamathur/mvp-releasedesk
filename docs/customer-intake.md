# Customer intake backlog

Multi-customer prioritized intake sitting **before** Lead / SDLC.

## Flow

1. Upsert customer (`customerId` unique)  
2. Enqueue request → creates **cost/billing estimate** keyed by the same `customerId`  
3. Weighted fairness rebalance (prevents one customer starving others)  
4. **Human cost approval** AND **human queue approval** (both required)  
5. Optional re-prioritize with **quick human sign-off**  
6. Lead starts only from `approved_for_dev` items → full SDLC (mandatory Security, ATLAS/OWASP on review-ready PRs, feature checklist, merge/release)  
7. Result feeds back to Lead  

Unapproved or partially approved items **must not** enter Lead/SDLC.

## Statuses

`queued` → `approved_for_dev` (both gates clear) | `rejected` → `in_dev` → `done`

## Contracts

- `@releasedesk/core` — `Customer`, `CustomerRequest`, `CostEstimate` (requires `customerId`), backlog queue, fairness weighting, intake audit  
- `@releasedesk/lead` — `CustomerIntake` (enqueue, dual approve, reorder+sign-off, `startLeadFromApprovedQueueItem`)  
- Release Desk UI — intake list with per-customer filter, cost beside each item, approve/reject controls  

MOCK billing source/currency when no real billing system is configured.
