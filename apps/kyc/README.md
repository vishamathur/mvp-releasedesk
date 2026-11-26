# @northwind/kyc

Northwind Bank Know Your Customer onboarding demo (Release Desk Milestone 1).

Customer identity and analyst review are separate sign-ins. The JSON store is AES-256-GCM encrypted. Field rules, the `occupation` classification, and the 90-day retention window are in [docs/PII.md](./docs/PII.md).

Prefer running from the repo root:

```bash
npm install
# Copy the KYC block from ../../.env.example into apps/kyc/.env.local
# Set KYC_DATA_KEY, KYC_CUSTOMER_TOKEN, and KYC_ANALYST_TOKEN. Never commit that file.
npm run seed
npm run dev
```

`npm run seed` loads `apps/kyc/.env.local` for `KYC_DATA_KEY` and writes `data/store.json` as ciphertext. `POST /api/seed` also needs an analyst session and `KYC_SEED_ENABLED=true`, and it is disabled when `NODE_ENV=production`.

Open [http://localhost:3000](http://localhost:3000). Sign in with the customer token to start an application, or the analyst token to open the queue.

Government ID and proof of address are still required before a case can leave draft. The demo stores document metadata only.

See the root [README](../../README.md) for mocked integrations and monorepo notes.
