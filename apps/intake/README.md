# Customer intake

Public door for `intake.vishalmathur.org`. A customer submits a request. The app writes an intake card addressed to Release Desk Lead (`46e50097-0409-4972-9be0-6ade37563135`) and, when configured, POSTs that card to Lead's channel.

- Existing customer and product → `PID-ER` on `#er-intake`.
- New customer → `PID-NC` on `#new-customer`.

The page does not approve finance, security, or release.

## Run the checks

```bash
php apps/intake/test.php
```

## GoDaddy

Upload the contents of this directory to the document root of `intake.vishalmathur.org`. Copy `config.example.php` to `config.php` on the server and set `lead_webhook` to the https endpoint that posts into Lead's channel. Leave it empty to keep cards in `storage/` only.

`config.php` is not committed. `storage/*.json` is not committed.

The domain's DNS currently points `intake` at `vishalmathur-intake.pages.dev`. A GoDaddy PHP document root is used only after that CNAME is removed and the subdomain is served by the hosting account.
