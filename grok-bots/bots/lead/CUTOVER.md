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

## N24 — open decision: what wakes Lead after cutover

Do not apply the cutover above until this is chosen. Do not build a wake-up path as part of this change.

After the cutover, nothing wakes Lead. Intake sends no handoff.v1 message. Lead's public webhook is removed. Release Desk Log only records a copy and cannot start work.

Pick one before cutover:

- (a) Keep the site on Lead's webhook (Path A) and drop Intake from the chain. Security's preference, with (b).
- (b) Add a Lead scheduled inbox poller that runs `verify_intake.py --file` on saved envelopes. Security's preference, with (a).
- (c) Add a signed Intake-to-Lead channel that is not handoff.v1.

(c) is not the preference. Leave this decision open until Vishal picks (a) or (b).

## N25 — switch the box off Path B in one step

Docs only. Do not edit files on the box from this repository change. When Vishal applies the cutover, switch the box skills, profiles and verifier off Path B together, in the same sitting:

1. Replace the box copy of validate-handoff so rule 13 still rejects kind intake-request, and rule 3 still rejects any from=intake message that is not addressed to Lead as intake_only_to_lead. Intake does not send a handoff.v1 message.
2. Intake's profile stops sending intake-request. It verifies the site notice, saves the envelope, and does not hand a message to Lead.
3. Lead's profile and public-intake-relay drop Path B. Lead re-checks a saved envelope with verify_intake.py --file and does not expect an intake-request.
4. Replace `/workspace/releasedesk-state/bin/verify_intake.py` with the copy from a full checkout of this repo (`grok-bots/tools/verify_intake.py` together with `apps/intake-cloudflare/scripts/verify_intake_ref.py`). The installed verifier must require kind, refuse redirects, and fail closed on a corrupt or unreadable seen-set.
5. Confirm the three box surfaces (skills, profiles, verifier) match this repo before the next public card. A skill that still mentions Path B, a profile that still sends intake-request, or the old verifier left in place means the cutover is not done.
