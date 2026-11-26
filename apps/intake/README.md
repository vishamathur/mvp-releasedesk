# Public intake agent for intake.vishalmathur.org (GoDaddy cPanel, PHP) — NOT DEPLOYED

A Cloudflare Pages build with the same endpoints, D1 storage and the same front end is in [`apps/intake-cloudflare`](../intake-cloudflare/README.md).

Two entry options (New customer → PID-NC, Enhancement Request acceptance → PID-ER), a Grok chat assistant that fills the form,
an EXAMPLE service catalogue, a finance estimation model (deterministic catalogue math + Grok recommendation), and a
two-way relay with Release Desk Lead. See `docs/intake/lead-integration.md`.

Enhancement requests ask for a customer id in the canonical `cust_<slug>` form (for example `cust_1042`), matching `CustomerIdSchema` in `@releasedesk/core`.

## Upload map
| Local | Server |
|---|---|
| `intake-docroot/*` (incl. `.htaccess`, `api/*.php`) | subdomain document root, e.g. `~/intake.vishalmathur.org/` |
| `intake-private/*` (incl. `.htaccess`) | `~/intake-private/` (outside public_html) |
| `intake-private/intake-config.example.php` | copy to `~/intake-private/intake-config.php`, fill secrets, chmod 600 |

Requires PHP 8.1+, ext-curl, Apache mod_rewrite/mod_headers.

## Endpoints
| Path | Who | Purpose |
|---|---|---|
| `GET api/catalogue.php` | public | EXAMPLE catalogue: services, enhancements, new applications |
| `POST api/chat.php` | public (30/10 min/IP) | Grok assistant; returns reply + draft fields; emails/phones redacted before the model |
| `POST api/intake.php` | public (5/10 min/IP) | validate → finance model → card + handoff draft → outbox → Lead; returns `{ok, referenceId, statusToken, message}` |
| `GET/POST api/status.php` | visitor with ref + key | status, Lead's quote and messages; send a message to Lead |
| `POST api/finance-estimate.php` | Lead (HMAC) | finance model as a service |
| `POST api/lead-update.php` | Lead (HMAC) | move public status, post quote / next gate / reply |

`statusToken` is new versus the earlier build: references are guessable, so the status page needs a private key. It lives in the URL fragment and is stored only as a hash.

## Grok
`POST https://api.x.ai/v1/chat/completions`, `response_format: json_schema (strict)`, model `grok-4.20-0309-non-reasoning` by default (≈1–2 s; `grok-4.3` ≈15 s).
Customer text is fenced as untrusted; the model can only draft fields or recommend. Chat fails clearly when the API is unavailable. A selected catalogue option is priced from its bill of materials without calling Grok. Free-text finance mapping calls Grok and fails clearly when the key is missing.

The catalogue is append-only. `services[]` are priced building blocks (`SVC-WEB` and `SVC-AI` are two of them; another block is another row). `enhancements[].options[]` are changes to an existing application. `newApplications[]` are templates, each with `addOns[]` in the same option shape. An option is `{id, name, description, billOfMaterials:[{serviceId, qty}], targetServiceId?}`. Optional showcase fields are `showcase45` (boolean), `grokApi` (list of strings) and `demoScript` (one line). Adding a small option or a building block does not need a code change. Every id is unique. A bill of materials names only services in `services[]`, and each quantity is an integer of at least 1.

## Tests
`bash tests/run-tests.sh` — unit checks for catalogue math, policy, validation, handoff, and the Grok request body, plus HTTP checks that do not call Grok. There is no mock mode. A missing `GROK_API_KEY` is a configuration error. Chat completions send the shared guidelines and a hashed safety identifier. See `docs/security/grok-guardrails.md`.
