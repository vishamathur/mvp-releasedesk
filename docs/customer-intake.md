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

- `@releasedesk/core` — `Customer`, `CustomerRequest`, `CostEstimate` (requires `customerId`), backlog queue, fairness weighting, intake audit, `CustomerStore`
- `@releasedesk/lead` — `CustomerIntake` (enqueue, dual approve, reorder+sign-off, `startLeadFromApprovedQueueItem`)  
- Release Desk UI — intake list with per-customer filter, cost beside each item, approve/reject controls  

A cost estimate requires an explicit `source` of `billing_system`. Omitting it throws. Currency defaults to USD when it is not passed.

## Customer id

The canonical `customerId` is `cust_` plus a slug: `/^cust_[a-z0-9][a-z0-9_-]*$/i`, at least 6 characters. Cost and billing records already use this form (`cust_northwind`, `cust_contoso`, `cust_fabrikam`). The public intake form uses the same form (placeholder `cust_1042`). Project references stay on their own pattern (`PRJ-ONB-7`).

## Customer store

`CustomerStore` persists `Customer` and `CustomerRequest` documents, validated with the Zod schemas. `InMemoryCustomerStore` is for tests and starts empty. `FileCustomerStore` is a LowDB document file. The path is the constructor `filePath`, or `RELEASEDESK_CUSTOMER_DB_PATH`, or `packages/releasedesk-core/data/customers.json` (gitignored). The file is created on the first upsert. Opening the store does not insert rows.

Upsert keeps `createdAt` and sets `updatedAt` to the current time. Requests are stored on the same interface and listed by `customerId`.

Customer repo naming rule: a customer repo is named `<customer>-ER` or `<customer>-<request>` (lowercase words joined by dashes), for example `acme-ER` or `acme-kyc-occupation`. Northwind Bank's `DEMO_PORTFOLIO` entry targets `vishamathur/northwind-bank-kyc-identity` (base `main`). Existing repos are not renamed.

Demo customers are opt-in and idempotent. `seedDemoCustomers(store, { enabled: true })`, or `RELEASEDESK_SEED_DEMO_CUSTOMERS=1`, inserts the three `DEMO_PORTFOLIO` apps (Northwind Bank, Contoso Retail, Fabrikam Logistics) when those ids are missing. Each row has `metadata.demo = true` and the repo `MockMeta` label. A second seed leaves existing rows alone, including a real customer that already uses one of those ids.

```bash
RELEASEDESK_SEED_DEMO_CUSTOMERS=1 npm run seed:customers
npm run seed:customers -- --demo
```
