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
| `GET /api/catalogue.php` | public | EXAMPLE catalogue, `Cache-Control: public, max-age=300` (or `no-store` while submissions are paused) |
| `POST /api/chat.php` | public, 30 per 10 min per IP | Grok strict-schema call, emails and phones redacted first. Stays up while submissions are paused, including the daily cap and markup filter |
| `POST /api/intake.php` | public, 5 per 10 min per IP | validate, price the catalogue option, store the card, signed outbox to Lead. When `INTAKE_SUBMISSIONS_PAUSED` is `1` (or `true`/`yes`/`on`), this returns `503 submissions_paused` and stores or sends nothing |
| `POST /api/status.php` | visitor with `{ref, token}` in the body | 60 reads and 10 messages per 10 min per IPv6 /64. The token is not accepted in the query string. A visitor-message POST returns `503 submissions_paused` while paused; a read stays up |
| `POST /api/finance-estimate.php` | Lead, HMAC | `X-Intake-Timestamp` (±300 s) + `X-Intake-Signature` |
| `POST /api/lead-update.php` | Lead, HMAC | idempotent on `updateId`, backwards moves are 409 |
| `POST /api/style.php` | public, shares the chat limit | **Cloudflare build only.** Inspiration photo for Website creation: see below |
| `GET /api/envelope.php` | Lead, `Bearer LEAD_FETCH_KEY` | **Cloudflare build only.** Failed auth is limited to 120 per 10 min per /64. A valid key is not limited. Envelope kept 24 h |

Any other `/api/*` path is 403, as with the PHP `.htaccess`.

The assistant never gets tools, secrets, status data, or a path to Lead other than the form a person submits. Chat uses `GROK_CHAT_API_KEY` only. An empty chat key refuses the call and does not borrow `GROK_API_KEY`. `CHAT_DAILY_MAX` (default 3000) is a daily ceiling across all visitors. Rate limits use the IPv6 /64.

Production deploys should be Git-connected (or `wrangler pages deploy` from a tagged commit) so `deployment_trigger.metadata.commit_hash` is authoritative. The live project was an ad-hoc upload. Connecting it is an operator step and is not done in this change.

## Inspiration photo (Website creation, capture only)

On the Website creation form a visitor can add one optional inspiration photo. The browser checks the type and size,
redraws photos over 1 MB as a JPEG about 1600 px wide, and posts the raw image to `api/style.php` with `X-Session-Id`.
The worker checks the origin, accepts only `image/jpeg`, `image/png` or `image/webp` whose magic bytes match the declared
type, enforces 4 MB, and uses the chat rate limit. It sends the image to Grok vision (`GROK_VISION_MODEL`, or `GROK_MODEL`
when that is unset) with a strict schema. Grok returns a neutral description: up to six palette colours as hex, mood,
textures, typography feel and layout cues. Text inside the image is treated as part of the picture, never as an instruction.
The visitor sees the swatches and the style text before submitting.

- The image is never stored, logged or put in the envelope. Only the style text (at most 800 characters) goes into the
  website brief (`ask.description` and `requestDetails.website.style`, with `styleSource: "grok-vision:inspiration-photo"`).
- The style text carries an HMAC (`style.v1.`, under the derived style purpose key, or `STYLE_SIG_SECRET` when that secret is set). `api/intake.php` rejects style
  text that was edited or not issued by the site. This only proves where the text came from. The intake code adds no
  design rules or acceptance criteria; Standards' website template owns those.
- No key, or a failed Grok call, is a real `503 grok_unavailable` with a fixed public message. The reason is logged. The visitor can still submit without a photo.
- The PHP build has no `style.php`. The shared front end shows the honest error there.

## Webhook notice and fetch-back

Lead's routine run sees only the webhook's wake text, cut at about 5 KB. So the webhook carries a small signed notice
`{source, kind, requestId, ts, payloadSha256, sig}`, and Lead fetches the full envelope from `GET /api/envelope.php`
with `Authorization: Bearer <LEAD_FETCH_KEY>`. Envelopes can be fetched for 24 hours. Details are in
[`docs/intake/lead-integration.md`](../../docs/intake/lead-integration.md).

## What changed from the PHP build

| PHP / cPanel | Cloudflare Pages |
|---|---|
| `intake-private/lib/*.php` | `src/worker.mjs`, bundled with the catalogue into `dist/_worker.js` |
| `data/` JSON files with `flock` | D1 database bound as `DB` (`migrations/0001_init.sql`, same as `schema.sql`) |
| `data/ratelimit/*.json` | `rate_hits` table, sliding window, one atomic batch per hit, IP stored only as a hash |
| `bin/drain-outbox.php` on cPanel Cron | Failed messages are retried from `waitUntil` on later API calls, at most every 5 minutes, up to 5 a run, `dead` after 50 attempts. Pages has no Cron Triggers |
| hourly `intake_cleanup()` | the same purge, 24 h after `created_at` plus the next API call, including a catalogue read. An idle site keeps rows until that call. Pages has no Cron Triggers |
| `intake-config.php` | `[vars]` in `wrangler.toml` plus four Pages secrets. Optional var: `GROK_VISION_MODEL`. Fifth secret: `LEAD_FETCH_KEY` |
| `LEAD_DELIVERY=email` (`mail()`) | not available. Use `webhook`. Choosing `email` is a delivery error, never a silent success |
| `REMOTE_ADDR` | `CF-Connecting-IP` |
| `.htaccess` headers | `static/_headers` for static files, the same headers set by the worker on API responses |

Nothing else changes: the HMAC rule, the visitor token (16 random bytes, stored as a SHA-256 hash), the honeypot field
`website`, the catalogue label "EXAMPLE DATA - illustrative prices only", Grok's guidelines, hashed `safety_identifier` and
30 s timeout, the `<visitor_input>` fence, and the finance policy (deterministic floor, Grok can only tighten). There is no
mock mode: a missing key, a Grok error or a failed webhook is a real error response.

## Enhancement requests need a repository (PID-ER)

An enhancement changes something that already exists, so every enhancement option (and the `er` route) needs a repository or
codebase Release Desk can read. The form asks first, before the rest of the form is shown; the server enforces the same rule.

| Step | What happens |
|---|---|
| Visitor says there is **no** repository or codebase | The page explains an enhancement can't be acted on without one and offers New application or Website creation. The rest of the form stays hidden. `POST /api/intake.php` with `hasRepo` not `true` is `422 repo_required` (`reason: no_repository`) and stores nothing. |
| Visitor says there **is** one | The form collects code host, `owner/repo` or https address, default branch, a short stack description and a technical contact reference. **Check repository** calls `POST /api/repo-check.php` (20 per 10 min per IP). |
| GitHub | `GET https://api.github.com/repos/{owner}/{repo}` with a User-Agent and no token. Redirects are not followed off `https://api.github.com`. A public 200 is `verified`, which means publicly readable, not that the visitor owns it. 404 is `access-pending`. 403/429/network errors are `check-unavailable` (503, retry later). |
| Private GitHub repo | Looks the same as a repository that does not exist: `access-pending`, and the response does not include visibility, the host's default branch, or a name GitHub returned. `GITHUB_REPO_CHECK_TOKEN` is never sent on this public path. The page still tells the customer how to invite `vishamathur`, but this check cannot confirm that invitation. |
| Other hosts | Not probed. GitLab, Bitbucket and any other host are `access-pending` with reason `host_not_allowlisted` and are not accepted. |
| Submit | `POST /api/intake.php` re-runs the same public check, keyed in the cache by the caller. Only `verified` is accepted. Anything else is `422 repo_not_verified` and nothing is stored or sent. Missing or malformed details are `400` with field names. |

A submitted card carries `repository: { host, repo, url, defaultBranch, stack, technicalContact, verification: { state, method, httpStatus, visibility, defaultBranchFromHost, checkedAt } }`
inside the signed payload. The proposed handoff summary says the repository is publicly readable and that this is not an ownership check. Only the Cloudflare build has this; the legacy PHP build in `apps/intake/private` does not enforce it.

## Build and test (live repository checks only)

```bash
node apps/intake-cloudflare/scripts/build.mjs            # writes apps/intake-cloudflare/dist/
node --test "apps/intake-cloudflare/test/*.test.mjs"     # Node 22.13+ or 24 (uses node:sqlite)
node apps/intake-cloudflare/test/bench-cpu.mjs           # rough CPU time per request
```

The tests port `apps/intake/tests/unit-tests.php` and `integration-tests.php` with the same fixtures, run the real SQL in
`migrations/` against in-memory SQLite, and fail on any network call except the live repository checks (`repo.test.mjs` and every test
that submits an enhancement call api.github.com, gitlab.com and bitbucket.org for real; unauthenticated GitHub allows 60 calls an hour per IP). Grok is never stubbed: the Grok tests check the
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
   npx wrangler pages secret put LEAD_HMAC_SECRET --project-name vishalmathur-intake   # openssl rand -hex 32; same file on the box: /workspace/releasedesk-secrets/intake-site-lead-hmac-secret
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
