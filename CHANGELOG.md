# Changelog

Notable changes to the Release Desk harness. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries name the pull request.

## [Unreleased]

### Security
- Public intake: purpose-separated HMAC keys, failed-auth-only envelope throttling, 24 h retention with a scheduled purge, contact email kept out of the Lead envelope, fixed public 503s, status token only in a POST body, and a typed extract that leaves free text quarantined (SEC-INTAKE-20261128 F1, F3–F12).
- Site assistant: IPv6 /64 and daily cap, a separate chat key with no fallback, draft validation, injection logging, client assistant turns dropped, a server-derived abuse id, wider redaction, and an in-widget AI disclosure (G1–G7).

### Added
- Agile process files: PR and issue templates (user story, bug, ER with Given/When/Then), CODEOWNERS, Definition of Ready and Done, working agreement, CONTRIBUTING (trunk-based, conventional commits), SECURITY, labels, dependabot.
- OWASP review on every pull request to main: 26 controls, rule-based selection, exception-only human review (#46).
- release-intel v2: grounded blockers, injection fencing, billed cost, fault-injection tests (#44).
