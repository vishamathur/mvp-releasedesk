# Northwind Bank — Authentication & Access Standards

Policy ID: `northwind-auth-standards`
Owner: Northwind Security Architecture

## Requirements

1. **Role separation** — Customer self-service flows and analyst review flows must remain distinct surfaces.
2. **No silent privilege escalation** — Demo apps must not grant analyst powers to anonymous customers without an explicit analyst mode.
3. **Human gates for release** — Merge and release decisions for regulated applications require human approval; agents must not auto-approve production merges.
4. **Dependency hygiene** — Known critical / high security advisories correlated to shipped components must be remediated or explicitly waived by a human before release.
5. **Transport** — Production deployments must use TLS; local demo HTTP is acceptable only for development.
