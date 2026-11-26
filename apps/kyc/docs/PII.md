# KYC personal data

Policy references: `northwind-data-retention` R-1, R-2, and R-4, `northwind-kyc-baseline` R-1, `northwind-auth-standards` R-1 and R-2.

**Demo / synthetic only.** The local encrypted file store is a demo store. It may hold only synthetic applicants (northwind-data-retention R-2). Do not enter real customer personal data. The same notice is shown in the KYC UI. The store refuses to run when `NODE_ENV=production` unless `KYC_ALLOW_LOCAL_STORE=true`, and that flag is still a demo override, not a production vault.

This demo does not store raw government ID numbers or document bytes. Document rows keep a type and a filename only. Logs must not print government ID numbers or document contents.

## FIELD SPEC — occupation

| Item | Rule |
| --- | --- |
| Names | `occupationCategory`, and `occupation` only when the category is `Other` |
| Type | `occupationCategory` is an enum string. `occupation` is a string. |
| Required | Optional. Omit both when the customer does not provide one. |
| Categories | `Employed`, `Self-employed`, `Student`, `Retired`, `Homemaker`, `Other` |
| Other detail | Required when the category is `Other`. 2–80 characters after trim. Letters, numbers, spaces, and `& ' . , ( ) -`. The first character must be a letter or number. |
| Other categories | No free-text detail. |
| Normalization | Leading and trailing whitespace is removed. An empty value is not stored. |
| Use | Shown on the customer form and the analyst case view. Not an input to risk scoring. |
| Backfill | Records with no occupation stay valid. A legacy free-text `occupation` with no category is read as category `Other`. A legacy plaintext `store.json` is refused; re-seed into the encrypted store. |

Other identity fields are allow-listed and length-checked in `src/lib/domain/validation.ts`:

| Field | Required | Length | Charset |
| --- | --- | --- | --- |
| `firstName`, `lastName` | yes | 1–80 | Letters, spaces, apostrophes, periods, hyphens |
| `dateOfBirth` | yes | `YYYY-MM-DD` | Age 18–120 |
| `nationality`, `country` | yes | 2 | ISO 3166-1 alpha-2, stored uppercase |
| `email` | yes | 3–254 | Single `@` and a dot in the domain |
| `phone` | yes | 8–20 | Digits, spaces, `+ - ( )` |
| `addressLine1` | yes | 1–120 | Letters, numbers, spaces, `# ' . , / -` |
| `addressLine2` | no | 0–120 | Same as address line 1 |
| `city` | yes | 1–80 | Letters, spaces, apostrophes, periods, hyphens |
| `postalCode` | yes | 2–16 | Letters, numbers, spaces, hyphens |

Create and update copy only these keys. Any other key, including a client-supplied `decidedBy`, is rejected or ignored. `decidedBy` is set from the authenticated analyst.

## PII CLASSIFICATION

**Classification: personal data, not special category, KYC due-diligence data under KYC retention.**

Occupation category and an optional Other job title are stored with the customer’s name and contact details, so they relate to an identifiable person. They are not special-category data. Special-category data covers racial or ethnic origin, political opinions, religious or philosophical beliefs, trade-union membership, genetic or biometric data, health, and sex life or sexual orientation. A job category or job title is none of those.

The value is optional, the category list is fixed, free text is only for Other, and the risk engine does not read it. Free text could still mention a special-category fact; the form does not ask for that. Approved records are kept under the KYC retention window below, not the 90-day draft window.

Security confirms this classification at the test gate.

## Retention (northwind-data-retention R-1)

| Status | Automatic deletion |
| --- | --- |
| `draft`, `rejected` | 90 days after `updatedAt` |
| `submitted`, `in_review`, `needs_info` | Not purged. These cases are still in progress. |
| `approved` | `KYC_APPROVED_RETENTION_DAYS`, default **5 × 365 days**. This default is a demo assumption pending compliance confirmation. |

Deletion paths, analyst-only:

- `DELETE /api/applications/:id` removes a non-approved application and writes an audit event.
- `DELETE /api/applications/:id?override=approved-retention` is the only way to remove an approved record. The audit action is `delete-approved-override`.
- `POST /api/retention/purge` removes only records past the window above.

Audit events store actor id and application ids, not identity fields. `POST /api/seed` replaces the synthetic cases and **appends** a `seed-replace` event to the existing audit log. Seed is disabled in production and unless `KYC_SEED_ENABLED=true`.

## Access

The shared `KYC_CUSTOMER_TOKEN` is an intake credential (`customer:intake`). It can start a case. It does not own one. Case creation returns a random applicant credential once. Only the SHA-256 hash is stored, on that case, and `createdBy` is `applicant:<id>`. That credential can read, update, add document placeholders, and submit only that case.

| Surface | Who |
| --- | --- |
| `POST /api/applications` | Intake token or an existing applicant session. Each create issues a new credential. |
| Identity update, document placeholder, submit, `GET /api/applications/:id` | The applicant credential for that case, or an analyst for the GET |
| `GET /api/applications`, analyst status changes, delete, retention purge, seed | Analyst token |
| `/applications/new` | Intake or applicant session |
| Customer case page | The applicant for that case |
| `/applications` queue | Analyst session |

Anonymous callers get 401. The wrong role gets 403. A customer asking for someone else’s case gets 404. Missing auth configuration fails closed with 503 and does not name environment variables. Analyst actions record `decidedBy` from the authenticated analyst, not from the request body.

Sign-in (`POST /api/auth/session`) locks out after 5 failures for 15 minutes, keyed by client address and token fingerprint. JSON bodies over 16 KiB are rejected with 413.

## Environment

Set these in `apps/kyc/.env.local` (Next.js reads that file). Do not commit it. Names are listed in the repo root `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `KYC_DATA_KEY` | yes | 32-byte AES-256-GCM key, 64 hex characters or standard base64. No default key. |
| `KYC_CUSTOMER_TOKEN` | yes | Intake bearer, at least 16 characters. Must differ from the analyst token. Not a case owner. |
| `KYC_ANALYST_TOKEN` | yes | Analyst bearer, at least 16 characters. |
| `KYC_ANALYST_ACTOR_ID` | no | Recorded as `decidedBy`. Default `analyst:northwind-demo`. |
| `KYC_SEED_ENABLED` | no | Exact `true` to allow `POST /api/seed` outside production. |
| `KYC_DATA_DIR` | no | Store directory. Default `apps/kyc/data`. |
| `KYC_APPROVED_RETENTION_DAYS` | no | Positive integer. Default 1825 (5 × 365). Demo assumption. |
| `KYC_ALLOW_LOCAL_STORE` | no | Exact `true` to allow the local demo store when `NODE_ENV=production`. Still synthetic-only. |

`KYC_CUSTOMER_ACTOR_ID` is not used. Case owners are server-generated applicant ids.

Tests set a labelled test key and test tokens in the test process only. Those values are not a production key.
