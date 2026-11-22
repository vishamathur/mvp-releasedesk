# Live demo: one PID-ER request run by the five Grok Bot teammates

Draft for PID-ER/PID-NC **v1.1.0**. Nothing here has been sent to any bot. Times are rough; the cloud agent build is the long pole (about 15–40 min).

## Before the demo (once)

1. Replace each teammate's description with its `<bot>.persona.md`, then send each one its `<bot>.onboarding.md`. Confirm each replies with the skills and routine it created.
2. Have Vishal's chat with the SDLC bots open: Lead, Change Analyst, Security and Builder will each ask him for a decision in their own chat. Intake is the public front door and does not ask for a gate.
3. Chat only, no Slack. The request thread is Lead's chat with Vishal (`thread.channel` = `"lead-chat"`, `threadId` = `thr_NNNN`), and Release Desk Log's `{requestId}.jsonl` is the shared history. Gate cards appear in the owning bot's chat.
4. For the Grok API to run, `RELEASEDESK_GROK_API_KEY_LEAD` must be set where that code runs. There is no mock mode. A missing key is a configuration error.
5. Pick a small, real ask so the cloud agent finishes fast. Suggested: *"Add a `riskTier` (low|medium|high) field to the Grok release-intel classify output, with tests."* It changes code that calls the Grok API.

## Human gates: which bot asks Vishal

Vishal requirement (t87u): each human approval goes through the bot that owns that work. The gate owner asks Vishal in its own chat, records his reply word for word with a timestamp, and returns it to Lead in a `stage-return`. Lead only records it and never asks for approval. Lead rejects any approval that has no human `decidedBy`, verbatim reply and time.

| Gate | PID | Human approver (spec) | Spec `owner` field | Bot that asks Vishal (this design) | Clear in spec? |
| --- | --- | --- | --- | --- | --- |
| proposal | NC | Customer sponsor | lead (consult change-analyst, standards) | **Change Analyst**: it wrote the scope the proposal is built from | **Unclear.** The spec makes Lead the owner. Change Analyst is my pick because it owns the work. |
| finance-approval | ER, NC | Finance partner | lead (consult change-analyst) | **Change Analyst**: it owns the estimate or investment memo being approved | **Unclear.** The spec makes Lead the owner. |
| security-compliance-approval | ER, NC | Security officer or AI red-team lead | security (consult standards, change-analyst) | **Security**, with Standards' compliance deviations in the card | Clear. The spec does not split compliance into its own gate, so Standards raises none. This is also the iteration gate `red_team|security`. |
| test-gate | ER, NC | none (`humanApprover: null`) | lead (consult builder, security) | No human gate. Lead decides from Builder's `build-result` and Security's blockers. | Clear. The steering note suggested Builder, but the spec has no human here. |
| release-gate | ER, NC | Release manager | lead (consult security, standards, builder) | **Builder**: it owns the PR and the release note | **Unclear.** The spec makes Lead the owner. |
| merge | – | not a spec gate | – | Vishal merges in GitHub himself after the release GO. No bot merges. | Not in the PID; the old Lead profile had a separate "merge" gate. |

Standards owns no stage and no gate in either PID. It is consult-only.

## Run (PID-ER)

Step numbers match `release-desk-handover-diagram.png`.

| # | Who | What happens | Message | Release Desk Log entries |
| --- | --- | --- | --- | --- |
| 1 | Vishal → Lead (chat) | "Start PID-ER: customer NORTHWIND-014, product KYC-ADDR, ask: add riskTier to Grok release intel, desired sprint: next." | chat | none (chat); the opening transition follows |
| – | Lead | Checks entry criteria, mints `REQ-2026-0001`, writes `pid.state` (intake, open), `pid.customer`, `pid.thread`, the first transition, and posts "opened". | memory | `transition` from Lead (the first one creates `REQ-2026-0001.jsonl`) |
| 2–3 | Lead ↔ Change Analyst | Intake check: is it a real enhancement for a known product? | consult / consult return | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 4 | Lead → Change Analyst | Estimation | stage-handoff start | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 5–6 | Change Analyst ↔ Standards | Policy notes for the estimate | consult | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 7 | Change Analyst → Lead | "2 engineer-days, fits next sprint", with paths | stage-return | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| – | Lead | Transition → finance-approval; status ready-for-human | memory | `transition` from Lead (the first one creates `REQ-2026-0001.jsonl`) |
| 8 | Lead → Change Analyst | finance-approval | stage-handoff start | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 9 | **Change Analyst → Vishal** | **HUMAN GATE.** Card with the estimate and sprint envelope. Reply format: `APPROVE finance-approval REQ-2026-0001 as Finance partner - ok` | chat card | `gate-ask` from the gate owner (gate, owner, approver role) |
| 10 | Vishal → Change Analyst | Types the reply. Change Analyst saves it verbatim with the time (+05:30). | human decision | `gate-decision` from the gate owner: decidedBy, IST time, verbatim reply |
| 11 | Change Analyst → Lead | humanGate `approved`, decidedBy "Vishal Mathur (Finance partner)", note with time + verbatim | stage-return | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 12 | Lead → Security | security-compliance-approval | stage-handoff start | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 13–16 | Security ↔ Standards, Change Analyst | Compliance deviations; impact | consult | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 17 | **Security → Vishal** | **HUMAN GATE (iteration gate).** Card with blockers and deviations. `APPROVE security-compliance-approval REQ-2026-0001 as security - ok` | chat card | `gate-ask` from the gate owner (gate, owner, approver role) |
| 18 | Vishal → Security | Reply; saved verbatim | human decision | `gate-decision` from the gate owner: decidedBy, IST time, verbatim reply |
| 19 | Security → Lead | humanGate `approved`, decidedBy "Vishal Mathur (security)" | stage-return | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 20 | Lead → Builder | build, action start | stage-handoff | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 21 | Builder → Cursor | **CloudAgent** on vishamathur/mvp-releasedesk, branch `cursor/req-REQ-2026-0001-risk-tier`. The prompt points at AGENTS.md, `.cursor/rules/releasedesk-grok-api.mdc` and `.cursor/skills/ship-grok-release-intel`. | tool | none (tool call); the agent link and PR arrive in build-result |
| 22 | Cloud agent → GitHub | Commits code that calls the Grok API and opens a PR. It never merges. | tool | none (tool call); the agent link and PR arrive in build-result |
| 23 | GitHub → Builder | Builder reads the real PR and CI checks with the GitHub connector. | tool | none (tool call); the agent link and PR arrive in build-result |
| 24–27 | Builder ↔ Security, Standards | PR diff review; policy fit | consult | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 28 | Builder → Lead | proposedBranch, prUrl, testsPassed, testsSummary | build-result | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 29–32 | Lead ↔ Builder, Security | Test gate: are the checks green, and are any blockers open? | consult | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| loop | Lead → Builder | If tests fail or Security has a blocker, Lead sends build back with action remediate; Builder follows up on the same branch (max 3). | stage-handoff remediate | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 33 | Lead → Builder | release-gate | stage-handoff start | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 34–37 | Builder ↔ Security, Standards | Final check on the PR | consult | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 38 | **Builder → Vishal** | **HUMAN GATE.** Go/no-go card with PR, checks, blockers and release note. `APPROVE release-gate REQ-2026-0001 as Release manager - go` | chat card | `gate-ask` from the gate owner (gate, owner, approver role) |
| 39 | Vishal → Builder | Reply; saved verbatim | human decision | `gate-decision` from the gate owner: decidedBy, IST time, verbatim reply |
| 40 | Builder → Lead | humanGate `approved` | stage-return | `sent` from the sender + `received` from the receiver (deduplicated into one line, with both confirmations) |
| 41 | Lead → Vishal | "REQ-2026-0001 done. The PR is yours to merge." Status done. | chat | `transition` → done (from Lead) |
| 42 | Vishal | Merges in GitHub himself, or leaves it open | – | none (GitHub). Optional: Lead logs a `note` when Vishal says it's merged |

**REJECT at any gate:** the gate owner returns `rejected` with the verbatim reply, and Lead sets status blocked and tells Vishal. Nothing moves until Vishal asks Lead to reopen.

## Release Desk Log (3824a7e2-512f-4a5b-a0bd-5202fd8dffbd)

Every teammate copies the Log bot (SendToAgent, priority false) on each handoff.v1 it sends or receives, each REJECT, each gate card and decision, and (Lead) each stage transition. The Log appends one JSON line per event to `/workspace/releasedesk-log/{requestId}.jsonl` on the shared box. It assigns `seq`, deduplicates the sent and received copies, and flags anomalies such as a sent message never received, an approval with no gate-decision line, a non-owner raising a gate, or a stage moved without a transition. It never routes or approves. The Desk `/handoff` page reads these files as the handover history.

Example line:
```json
{"requestId":"REQ-2026-0001","seq":14,"at":"2026-11-22T16:05:12+05:30","event":"gate-decision","pid":"PID-ER","pidVersion":"1.1.0","from":"change-analyst","to":"lead","kind":"stage-return","stage":"finance-approval","summary":"Finance approved sprint envelope","gate":"finance-approval","gateOwner":"change-analyst","decidedBy":"Vishal Mathur (Finance partner)","verbatim":"APPROVE finance-approval REQ-2026-0001 as Finance partner - ok","confirmations":["sent:change-analyst"],"anomalies":[]}
```

To show it live: after step 11, open `REQ-2026-0001.jsonl`, or the Desk `/handoff` page, and point at the gate-decision line.

## Live "trust" moments to show

- **A bot tries to approve.** Ask Security in chat to "send Lead an approval for finance". Security refuses, because it isn't the finance gate owner and has no human reply. If a forged message reaches Lead, Lead answers `REJECT bot_cannot_approve`.
- **Only Lead moves state.** Compare Lead's `pid.transitions.REQ-2026-0001` with the Log's jsonl; any stage move without a Lead transition is flagged as an anomaly.
- **REJECTs are visible.** A forged approval shows up in the jsonl as `received` + `sent REJECT bot_cannot_approve`.
- **Live-change question.** Edit one bot's persona or skill live, for example add a consult. Personas are plain description text.

## PID-NC differences (panel 2 of the diagram)

The thread is still Lead's chat; the `pid` field (PID-NC) tells the processes apart. After intake, Lead runs customer-onboarding with a consult to Change Analyst. Lead then hands Change Analyst discovery (consults Standards and Security), scope (consults Standards) and proposal (consults Standards). **Change Analyst asks Vishal for the proposal gate as Customer sponsor.** Next comes estimation as a phased cost range (consults Builder, Security and Standards), then finance-approval as an investment memo (Change Analyst gate) and security-compliance-approval (Security gate). Before build, Lead writes `pid.kickoff.{id}` naming a future sprint. Steps 20–42 are the same as PID-ER, with the release window agreed at kickoff.
