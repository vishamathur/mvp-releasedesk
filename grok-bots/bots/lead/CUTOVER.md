# Lead cutover to Intake-only (apply LAST, never in the same step as the merge)

The merge of this change leaves Lead in MODE transition: Lead accepts the site's direct webhook notice and intake-requests from Intake, so the live path keeps working while Intake's leg is proven.

Apply the steps below only after all of these are true: Intake's webhook routine is live; Intake and Lead read RELEASEDESK_INTAKE_HMAC_SECRET and RELEASEDESK_INTAKE_FETCH_KEY from the secure secrets store; this change is merged and the new verifier is installed on the box; `scripts/intake-inline-e2e.py` returned PASS and Release Desk Log shows the PROBE line from Lead; the Pages secrets LEAD_WEBHOOK_URL and LEAD_WEBHOOK_KEY now point at Intake's webhook (the values of INTAKE_WEBHOOK_URL and INTAKE_WEBHOOK_KEY) and the site is redeployed; and one real card submitted through the site reached Lead via Intake. Any failure: leave the site on Lead's webhook and do not apply.

1. Vishal types "cutover done" in Lead's chat.
2. In Lead's chat, replace skill public-intake-relay with `skills/public-intake-relay.cutover.md` from this folder.
3. Replace the sentence in Lead's persona that begins "PUBLIC REQUESTS (MODE transition" (it ends "public-status-update.") with:
   `Accept a public request only as intake-request from Intake. You do not take the public webhook. Post visitor-facing status on the site with skill public-status-update.`
   and the PUBLIC INTERFACE paragraph's first sentence with:
   `PUBLIC INTERFACE (skill public-intake-relay): the public webhook is Intake's, not yours. Intake verifies the notice and sends intake-request; you re-check the envelope it saved with verify_intake.py --file.`
4. Vishal removes Lead's own "public-intake" webhook routine (it no longer receives anything).
5. Repo: update `grok-bots/bots/lead/PERSONA.md` and `skills/public-intake-relay.md` to match (a follow-up PR).

Rollback: restore the transition skill and persona, recreate or keep Lead's routine, and set the Pages secrets LEAD_WEBHOOK_URL and LEAD_WEBHOOK_KEY back to Lead's webhook (the values of LEAD_WEBHOOK_URL_BOX and LEAD_WEBHOOK_KEY_BOX in the secure secrets store), then redeploy.
