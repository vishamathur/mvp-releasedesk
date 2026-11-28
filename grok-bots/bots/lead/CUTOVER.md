# Lead cutover to Intake-only (apply LAST, never in the same step as the merge)

The merge of this change leaves Lead on the site's signed notice. Intake verifies that notice, saves the envelope, and does not send a handoff.v1 message. intake-request is not a kind.

Apply the steps below only after all of these are true: Intake's webhook routine is live; Intake reads the site secret from the shared box files; this change is merged; `scripts/intake-inline-e2e.py` returned PASS and Release Desk Log shows the PROBE line from Lead; the Pages secrets LEAD_WEBHOOK_URL and LEAD_WEBHOOK_KEY now point at Intake's webhook and the site is redeployed; and one real card submitted through the site reached Lead via Intake. Any failure: leave the site on Lead's webhook and do not apply.

1. Vishal types "cutover done" in Lead's chat.
2. In Lead's chat, replace skill public-intake-relay with `skills/public-intake-relay.cutover.md` from this folder.
3. Replace the sentence in Lead's persona that begins "PUBLIC REQUESTS (MODE transition" (it ends "public-status-update.") with:
   `Accept a public request only as the signed notice Intake verified and saved. You do not take the public webhook. Intake does not send a handoff.v1 message. Post visitor-facing status on the site with skill public-status-update.`
   and the PUBLIC INTERFACE paragraph's first sentence with:
   `PUBLIC INTERFACE (skill public-intake-relay): the public webhook is Intake's, not yours. Intake verifies the notice and saves the envelope; you re-check it with verify_intake.py --file. A message from Intake that is not addressed to Lead is intake_only_to_lead.`
4. Vishal removes Lead's own "public-intake" webhook routine (it no longer receives anything).
5. Repo: update `grok-bots/bots/lead/PERSONA.md` and `skills/public-intake-relay.md` to match (a follow-up PR).

Rollback: restore the transition skill and persona, recreate or keep Lead's routine, and set the Pages secrets LEAD_WEBHOOK_URL and LEAD_WEBHOOK_KEY back to Lead's webhook (file lead-public-intake-webhook.json), then redeploy.
