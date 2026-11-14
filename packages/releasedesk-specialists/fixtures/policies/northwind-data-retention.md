# Northwind Bank — Data Retention Standards

Policy ID: `northwind-data-retention`
Owner: Northwind Data Governance

## Requirements

1. **PII retention window** — Customer PII retained in operational stores must have a documented retention window and deletion path.
2. **Demo stores** — Local JSON demo stores are allowed for Milestone demos when they contain only synthetic sample applicants.
3. **Secrets** — API keys, OCR vendor credentials, and screening vendor tokens must not be committed to source control.
4. **Log redaction** — Application logs must not print full government ID numbers or raw document contents.
5. **Export controls** — Bulk export of applicant data requires an explicit analyst action and audit event.
