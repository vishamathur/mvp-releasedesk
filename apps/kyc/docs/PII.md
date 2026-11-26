# KYC personal data

Policy references: `northwind-data-retention` R-1 and R-4, `northwind-kyc-baseline` R-1, `northwind-auth-standards` R-1 and R-2.

This demo stores synthetic or customer-entered identity for Northwind Bank (`cust_northwind`). It does not store raw government ID numbers or document bytes. Document rows keep a type and a filename only. Logs must not print government ID numbers or document contents.

## FIELD SPEC — `occupation`

| Item | Rule |
| --- | --- |
| Name | `occupation` |
| Type | string |
| Required | Optional. Omit the key, or send `""`, when the customer does not provide it. |
| Length | 2–80 characters after trim, when present. |
| Charset | Letters (Unicode), numbers, spaces, and `& ' . , ( ) -`. The first character must be a letter or number. |
| Normalization | Leading and trailing whitespace is removed. An empty value is not stored. |
| Use | Shown on the customer form and the analyst case view. Not an input to risk scoring. |
| Backfill | Existing records without `occupation` stay valid. Readers treat a missing key as “not provided”. Nothing rewrites old rows just to add the field. A legacy plaintext `store.json` is refused; re-seed into the encrypted store. |

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

## PII CLASSIFICATION — `occupation`

**Classification: personal data. Not special category.**

`occupation` is a job title stored on the same record as the customer’s name and contact details, so it relates to an identifiable person (ordinary personal data). It is not special-category data. Special-category data covers racial or ethnic origin, political opinions, religious or philosophical beliefs, trade-union membership, genetic or biometric data, health, and sex life or sexual orientation. A job title is none of those.

The form asks for a job title only. The value is optional, length-capped, and charset-limited, and the risk engine does not read it. Free text could still mention a special-category fact; that is out of scope for this field and must not be prompted.

Security confirms this classification at the test gate.

## Retention (northwind-data-retention R-1)

Operational KYC PII is kept for **90 days after `updatedAt`** (the last customer edit, submission, or analyst decision). That window covers abandoned drafts and closed cases.

Deletion paths, both analyst-only:

- `DELETE /api/applications/:id` removes one application immediately.
- `POST /api/retention/purge` removes every application whose `updatedAt` is 90 days old or older.

Both writes append an audit event (`actorId`, application ids, action) to the encrypted store. The audit event does not copy identity fields. `POST /api/seed` is not a retention delete; it replaces the demo store and is disabled in production.

## Access

| Surface | Who |
| --- | --- |
| `POST /api/applications`, identity update, document placeholder, submit | Customer token, and only for cases that customer created |
| `GET /api/applications`, `GET /api/applications/:id`, analyst status changes, delete, retention purge, seed | Analyst token |
| `/applications/new` and the customer case page | Customer session |
| `/applications` queue | Analyst session |

Anonymous callers get 401. The wrong role gets 403. Missing `KYC_CUSTOMER_TOKEN` or `KYC_ANALYST_TOKEN` fails closed with 503. Analyst actions record `decidedBy` from the token’s actor id, not from the request body.

## Environment

Set these in `apps/kyc/.env.local` (Next.js reads that file). Do not commit it. Names are listed in the repo root `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `KYC_DATA_KEY` | yes | 32-byte AES-256-GCM key, 64 hex characters or standard base64. No default key. |
| `KYC_CUSTOMER_TOKEN` | yes | Customer bearer, at least 16 characters. Must differ from the analyst token. |
| `KYC_ANALYST_TOKEN` | yes | Analyst bearer, at least 16 characters. |
| `KYC_CUSTOMER_ACTOR_ID` | no | Recorded as `createdBy`. Default `customer:northwind-demo`. |
| `KYC_ANALYST_ACTOR_ID` | no | Recorded as `decidedBy`. Default `analyst:northwind-demo`. |
| `KYC_SEED_ENABLED` | no | Set to `true` to allow `POST /api/seed` outside production. |
| `KYC_DATA_DIR` | no | Store directory. Default `apps/kyc/data`. |

Tests set a labelled test key and test tokens in the test process only. Those values are not a production key.
