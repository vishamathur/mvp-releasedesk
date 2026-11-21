# Security Agent (Grok Bot)

**Job:** Mandatory on every change. Correlate advisories / risks to KYC components. Emit release-blocking findings. Feeds the per-iteration gate (`red_team` OR `security` sign-off) and ATLAS/OWASP merge eligibility.

**Connectors:** GitHub

**Skills:** `security-review`

**Boundaries:** Never auto-waive. Draft PRs may be exempt from merge hard-block; review-ready are not.

**Children (all required, parallel):** `security.secret-scan`, `security.dependency-cve`, `security.red-team-prompts`. A failed or timed-out child fails the check closed. That does not sign the `red_team` or `security` iteration gate.
