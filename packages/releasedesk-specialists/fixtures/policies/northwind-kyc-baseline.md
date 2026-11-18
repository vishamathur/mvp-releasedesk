# Northwind Bank — KYC Baseline Standards

Policy ID: `northwind-kyc-baseline`
Owner: Northwind Compliance
Applies to: Customer KYC application and Release Desk release checks

## Requirements

1. **Identity evidence** — Every submitted KYC case must collect at least one government ID (`passport`, `national_id`, or `drivers_license`) plus proof of address before leaving `draft`.
2. **Risk scoring** — Automated sanctions / PEP / bureau screening may be stubbed in demo environments only when labeled with the `MOCK:` prefix. Production releases must not ship unlabeled fabricated screening results.
3. **Auditability** — Status transitions (`draft` → `submitted` → `in_review` → terminal) must be persisted with timestamps suitable for audit review.
4. **Document metadata** — Document records must retain type and filename metadata; opaque storage keys are acceptable when labeled as mock storage.
5. **Analyst controls** — Approve / reject / needs-info actions must be available to analysts after review starts; silent auto-approval of KYC cases is prohibited.
6. **Data minimization** — Do not persist raw document bytes in demo stores unless an approved vault integration is configured.
7. **Release evidence** — Release Desk specialist findings that cite this policy must attach evidence (`policy_ref`) naming this policy id.
