# Public intake site on Cloudflare Pages (free plan) — live at https://intake.vishalmathur.org

**Status: deployed.** This build serves https://intake.vishalmathur.org from the Cloudflare Pages project
`vishalmathur-intake` (production branch `main`, also at `vishalmathur-intake.pages.dev`). The D1 database
`vishalmathur-intake` is bound as `DB`. Intake cards and visitor messages are delivered to Release Desk Lead by webhook
(`LEAD_DELIVERY=webhook`, `Authorization: Bearer`), signed with HMAC-SHA256. Lead's `public-intake` routine checks the
signature and treats cards marked TEST as tests: it logs them and opens nothing. Secret values live only in Pages secrets,
never in this repo.

A port of [`apps/intake`](../intake) (PHP for GoDaddy cPanel) to Cloudflare Pages in advanced mode. The visitor
front end is the same file set (`apps/intake/public/index.html`, `app.js`, `styles.css`, copied at build time). The page offers three request types: Website creation (PID-NC with a website brief, see
[`apps/intake/README.md`](../intake/README.md#request-types)), New application (PID-NC) and Enhance an existing service (PID-ER).
The six
endpoints keep their paths and their request and response shapes, so the front end, Release Desk Lead's skills
(`finance-estimate`, `public-status-update`) and the Intake routine need no change:

| Path | Who | Notes |
|---|---|---|
| `GET /api/catalogue.php` | public | EXAMPLE catalogue, `Cache-Control: public, max-age=300` |
| `POST /api/chat.php` | public, 30 per 10 min per IP | Grok strict-schema call, emails and phones redacted first |
| `POST /api/intake.php` | public, 5 per 10 min per IP | validate, price the catalogue option, store the card, signed outbox to Lead |
| `GET/POST /api/status.php` | visitor with ref + token | 60 reads and 10 messages per 10 min per IP |
| `POST /api/finance-estimate.php` | Lead, HMAC | `X-Intake-Timestamp` (±300 s) + `X-Intake-Signature` |
| `POST /api/lead-update.php` | Lead, HMAC | idempotent on `updateId`, backwards moves are 409 |

Any other `/api/*` path is 403, as with the PHP `.htaccess`.

## What changed from the PHP build

| PHP / cPanel | Cloudflare Pages |
|---|---|
| `intake-private/lib/*.php` | `src/worker.mjs`, bundled with the catalogue into `dist/_worker.js` |
| `data/` JSON files with `flock` | D1 database bound as `DB` (`migrations/0001_init.sql`, same as `schema.sql`) |
| `data/ratelimit/*.json` | `rate_hits` table, sliding window, one atomic batch per hit, IP stored only as a hash |
| `bin/drain-outbox.php` on cPanel Cron | Pages has no Cron Triggers. Failed messages are retried from `waitUntil` on later API calls, at most every 5 minutes, up to 5 a run, `dead` after 50 attempts |
| hourly `intake_cleanup()` | the same, from `api/intake.php`: submissions, finance artifacts, status, sent messages and events older than `RETENTION_DAYS` (30) |
| `intake-config.php` | `[vars]` in `wrangler.toml` plus four Pages secrets |
| `LEAD_DELIVERY=email` (`mail()`) | not available. Use `webhook`. Choosing `email` is a delivery error, never a silent success |
| `REMOTE_ADDR` | `CF-Connecting-IP` |
| `.htaccess` headers | `static/_headers` for static files, the same headers set by the worker on API responses |

Nothing else changes: the HMAC rule, the visitor token (16 random bytes, stored as a SHA-256 hash), the honeypot field
`website`, the catalogue label "EXAMPLE DATA - illustrative prices only", Grok's guidelines, hashed `safety_identifier` and
30 s timeout, the `<visitor_input>` fence, and the finance policy (deterministic floor, Grok can only tighten). There is no
mock mode: a missing key, a Grok error or a failed webhook is a real error response.

## Build and test (no network, no account)

```bash
node apps/intake-cloudflare/scripts/build.mjs            # writes apps/intake-cloudflare/dist/
node --test "apps/intake-cloudflare/test/*.test.mjs"     # Node 22.13+ or 24 (uses node:sqlite)
node apps/intake-cloudflare/test/bench-cpu.mjs           # rough CPU time per request
```

The tests port `apps/intake/tests/unit-tests.php` and `integration-tests.php` with the same fixtures, run the real SQL in
`migrations/` against in-memory SQLite, and fail on any network call. Grok is never stubbed: the Grok tests check the
request body and the error path only.

## Deploy

These are the steps the live site was set up with. To redeploy after a change, run steps 1 and 8 only:
`node scripts/build.mjs`, then `npx wrangler pages deploy dist --project-name vishalmathur-intake --branch main`.

All commands run from `apps/intake-cloudflare/`. Use `npx wrangler@latest` or a local install.

1. **Build:** `node scripts/build.mjs`.
2. **Log in:** `npx wrangler login`.
3. **Create D1:** `npx wrangler d1 create vishalmathur-intake`. Put the printed `database_id` in `wrangler.toml`
   (an id is not a secret).
4. **Create the tables:** `npx wrangler d1 migrations apply vishalmathur-intake --remote`.
5. **Create the Pages project:** `npx wrangler pages project create vishalmathur-intake --production-branch main`.
   Check that the project's subdomain is exactly `vishalmathur-intake.pages.dev`. If the name is taken, Cloudflare adds a
   suffix, and the CNAME in step 9 must use the real name.
6. **Bind D1:** the `[[d1_databases]]` block in `wrangler.toml` binds it as `DB` on deploy. To do it by hand instead:
   project → Settings → Bindings → Add → D1 database, variable name `DB`.
7. **Secrets** (prompted, never on the command line or in git):
   ```bash
   npx wrangler pages secret put GROK_API_KEY     --project-name vishalmathur-intake
   npx wrangler pages secret put LEAD_HMAC_SECRET --project-name vishalmathur-intake   # openssl rand -hex 32; same value in Lead's vault as intake-site-hmac
   npx wrangler pages secret put LEAD_WEBHOOK_KEY --project-name vishalmathur-intake   # the Lead intake routine's secret key
   npx wrangler pages secret put LEAD_WEBHOOK_URL --project-name vishalmathur-intake   # the Lead intake routine's https URL
   ```
   Set `LEAD_WEBHOOK_AUTH` in `wrangler.toml` to `header:<Name>` if the routine wants a named header instead of `Bearer`.
8. **Deploy:** `npx wrangler pages deploy`. Then check `https://vishalmathur-intake.pages.dev/` and
   `https://vishalmathur-intake.pages.dev/api/catalogue.php`. Browser POSTs from the `pages.dev` origin get
   `403 forbidden_origin` until the custom domain is live, unless that origin is added to `ALLOWED_ORIGINS`.
9. **Custom domain, then DNS:** project → Custom domains → Set up a custom domain → `intake.vishalmathur.org`. Only after
   Cloudflare shows the domain as pending, add or confirm at GoDaddy DNS:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `intake` | `vishalmathur-intake.pages.dev` | 1 hour |

   Keep the GoDaddy nameservers. Do not touch the other records (including the `MS=...` TXT record). Cloudflare issues the
   certificate after the CNAME resolves.
10. **Smoke test** on `https://intake.vishalmathur.org`: the catalogue shows the EXAMPLE label; a chat turn answers (or
    returns a clear `grok_unavailable`); a test submission returns a reference and status link; Lead receives the signed
    `intake-card`; a signed `lead-update` changes the status page.

## Free plan limits (as documented by Cloudflare; check before go-live)

- Pages Functions share the Workers free quota: 100,000 requests a day, reset at 00:00 UTC (05:30 IST). Static files are
  not counted, because `_routes.json` sends only `/api/*` to the worker.
- 10 ms CPU per request. Waiting on D1, Grok or the webhook is not CPU time. Measured locally with
  `test/bench-cpu.mjs`: about 0.1–0.7 ms median and under 2 ms p95 per endpoint once warm, about 2 ms to index the
  catalogue on an isolate's first request.
- D1 free: 5 million rows read and 100,000 rows written a day, 5 GB. Each submission writes about 6 rows.
- 50 subrequests per request. The worker makes at most one Grok call or one webhook call, plus up to 5 retries in a drain.
