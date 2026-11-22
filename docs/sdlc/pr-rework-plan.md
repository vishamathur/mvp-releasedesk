# PR #36 rework plan: bot-native Release Desk, mapped to the MVP requirement

PR: https://github.com/vishamathur/mvp-releasedesk/pull/36 (branch `cursor/desk-e2e-handover-6823`, head `929ea94`, 33 files, base `main` @ `1ecfc1c`). Final draft, updated for Vishal's decisions (t94u, plus the 3:34 PM decisions): Release Desk Log JSONL is the Desk trace source, the Grok key goes in as an Actions secret, the PIDs bump to 1.1.0, and the system is chat only. The repo has not been touched.

Status key: **Done** = exists and works today. **Partial** = designed or mocked but not live. **Missing** = not built.

---

## (a) Requirement traceability

The source is `/workspace/spacexsi-req/requirement.txt` (challenge PDF and Venkat's prep notes). PR #36 paths are marked [PR]; paths already on `main` are marked [main].

| # | Requirement (from the brief) | Grok Bot-native design | Code / repo | Status | To close it |
| --- | --- | --- | --- | --- | --- |
| R1 | A lead bot and at least 3 specialist bots, each with a clear job and boundary | Lead plus Change Analyst, Standards, Security and Builder. Each `<bot>.persona.md` has a role, boundary and owned stages. | [main] `grok-bots/registry.json` (5 live teammate ids), `grok-bots/definitions/*.json`; [PR] `packages/releasedesk-core/src/handoff/bots.ts` (mock roster) | Partial | Apply the 5 personas to the live teammates; commit them under `grok-bots/personas/` |
| R2 | Bots hand work to each other as Grok Bot teammates | handoff.v1 JSON over SendToAgent, with only Lead moving stages. Each bot runs `validate-handoff`, rejects bad messages back to the sender, and copies every message and REJECT to Release Desk Log. | [PR] `grok-bots/protocols/handoff.v1.json`, `stage-transition.v1.json`, `packages/releasedesk-core/src/handoff/schema.ts`, `engine.ts` (simulation) | Partial | Today the handover runs in app code. Onboard the bots and run one live PID-ER. |
| R3 | Uses channels | Chat only (decided). The request thread is Lead's chat with Vishal (`thread.channel` = `lead-chat`). Each gate is asked in the owning bot's chat. Teammate messages are the bot-to-bot channel. Release Desk Log (3824a7e2-…) is the shared audit channel and writes `/workspace/releasedesk-log/{requestId}.jsonl`. | [PR] `docs/sdlc/overview.md`, `grok-bots/processes/*.json` `entry.channel` (still Slack names) | Partial | B2: change `entry.channel` to `lead-chat` and drop `#release-desk` mirrors |
| R4 | Uses routines | Lead `stalled-requests` (15 min); Change Analyst and Security `pending-consults`; Builder `watch-build` | none (routines live in the bots) | Missing | Bots create them from the onboarding messages; commit their text under `grok-bots/personas/` |
| R5 | Uses connectors | GitHub (all read; Builder reads PR and checks); Cursor CloudAgent (Builder). No Slack. | [main] `grok-bots/bots/*/PERSONA.md` (connector lists) | Partial | Confirm the GitHub connector is on each teammate |
| R6 | Uses skills | validate-handoff (all); open-request and advance-stage (Lead); estimate-change, discovery-and-scope, draft-proposal (Change Analyst); check-compliance (Standards); security-review (Security); launch-cursor-build (Builder); raise-human-gate (Change Analyst, Security, Builder) | [main] `grok-bots/bots/*/skills/*.md` (old versions) | Missing (drafted) | Bots save them; replace the old skill files in the repo |
| R7 | Uses memory | Per-bot memory: Lead is the sole writer of `pid.state.{id}`, plus transitions, decisions, kickoff and build. Specialists keep `pid.slice.*` and `pid.gate.*`. Shared durable history: Release Desk Log's append-only `{requestId}.jsonl` on the shared box. | [PR] `handoff/store.ts` (file store standing in for memory) | Missing (drafted) | Created on the first live run; B5 makes Desk read the JSONL |
| R8 | At least one bot launches a Cursor cloud agent that changes a real repo | Builder `launch-cursor-build` runs CloudAgent on the repo, branch `cursor/req-<id>-<slug>` | [PR] `bots.ts` Builder is a mock (`cloudClient: "mock"`) | Partial | First live Builder run |
| R9 | The agent is guided by rules and skills you wrote | The Builder prompt names AGENTS.md, the rule and the skill | [main] `AGENTS.md`, `.cursor/rules/releasedesk-grok-api.mdc`, `.cursor/skills/ship-grok-release-intel/SKILL.md` | Done (files) / Partial (not yet used by a bot launch) | Add a bot-native section to the rule (no merge, branch naming, PR title with requestId) |
| R10 | The result comes back into the bot workflow | Builder `build-result` (prUrl, testsPassed from real checks), then Lead's test gate, then Builder's release gate | [PR] `schema.ts` build-result fields; `engine.ts` test gate | Partial | Live run |
| R11 | What the agent ships calls the Grok API to do real work (structured output the bots act on) | The shipped PR's code calls Grok (classify + summarize + riskTier). A CI job posts the structured result on the PR. Builder copies it into build-result, and Security and Lead act on it at the test gate. | [main] `apps/releasedesk/src/lib/grok-release-intel.ts`, `apps/releasedesk/src/app/api/grok/release-intel/route.ts` (MOCK without `RELEASEDESK_GROK_API_KEY_LEAD`) | Partial (no key, not in the workflow) | B6; Vishal adds the Actions secret `RELEASEDESK_GROK_API_KEY_LEAD` (approved) |
| R12 | Human approval points | Each gate is raised by the bot that owns the work (Change Analyst: proposal, finance; Security: security-compliance, the iteration gate; Builder: release). Vishal's reply is recorded verbatim, and Lead rejects any approval that has no human `decidedBy`. | [PR] `schema.ts` `bot_cannot_approve`, `engine.ts recordHumanDecision`, `apps/releasedesk/src/app/api/handoff/[requestId]/decision/route.ts` (Lead-posted gates) | Partial | Changes B2–B3: gate owner in the spec and engine |
| R13 | Trigger live, end to end | "Start PID-ER …" in Lead's chat (`demo-script.md`) | [PR] `apps/releasedesk/src/app/handoff/page.tsx` (simulated run) | Missing (live) | Dry run before the session |
| R14 | Open the system: each bot's persona, skills, routines, connectors and **voice setup** | Personas, skills and routines are committed text | none for voice | Partial / **voice Missing** | Decide whether any step uses voice (for example, Vishal giving a gate decision on a call to the owning bot) |
| R15 | Show the repo, rules, skills, cloud agent run and where the Grok API is called | Builder's build-result links the agent run and PR; the Grok call sits in the shipped code | as R9 and R11 | Partial | Live run |
| R16 | Walk trigger to output, including every handoff and every human approval | 42-step trace (`release-desk-handover-diagram.png`); Release Desk Log JSONL (one line per message, REJECT, gate ask, decision and transition, with anomaly flags) | [PR] `HandoffBoard.tsx`, `/handoff` page (simulation) | Partial | B5: Desk `/handoff` reads the Log JSONL |
| R17 | Why the bot hands off to an agent, and what context it passes | The `launch-cursor-build` prompt: goal, acceptance, rules, skill, guardrails | [main] `grok-bots/bots/builder/skills/launch-cursor-coding-agent.md` (old) | Partial | Replace it with launch-cursor-build |
| R18 | Show how to check the output is right (trust) | `validate-handoff` with reject codes; verbatim human decisions; independent Log bot that flags anomalies; Grok `trustCheck`; real CI checks; Security blockers stop the test gate | [main] `grok-release-intel.ts` trustCheck; [PR] `schema.ts`, `handoff.test.ts` | Partial | Add tests for gate-owner returns (B3) |
| R19 | Handle live changes to the bots | Personas are plain text under about 3.5k characters, with skills as separate notes | n/a | Done (design) | – |
| R20 | Slides: (1) problem and assumptions, (2) architecture diagram, (3) optional trade-offs | Diagram drafted (`release-desk-handover-diagram.png`) | [main] `docs/spacexai-slide-1-problem.md`, `docs/spacexai-slide-2-architecture.md`, `docs/spacexai-two-slides.md` | Partial | Update slide 2 to the bot-native architecture and the new diagram; write the optional slide 3 |
| R21 | Pick a real enterprise problem and go deep (Space 1, release readiness) | Northwind KYC release desk, PID-ER and PID-NC | [PR] `grok-bots/processes/*.json`, `docs/sdlc/*` | Done | – |
| R22 | Accounts: Grok Bot, Cursor with cloud agents, and a Grok API key | Six teammates exist (5 workflow bots + Log); Builder needs CloudAgent access | [main] `.env.example` (key names) | Partial | Vishal adds `RELEASEDESK_GROK_API_KEY_LEAD` as a repo Actions secret; it is never committed |
| R23 | Why a business would pay; enterprise constraints (access, approvals, cost, failure, adoption) | Role-scoped bots, human gates, SLAs, the stalled routine, retry cap of 3, routine caps | [PR] `docs/sdlc/PID-*.v1.md` | Partial | Slide 1 and slide 3 content |
| R24 | "Not one bot with a long prompt"; Cursor alone isn't enough | 5 bots, each with an owned stage or a consult role; Desk app has no orchestration | [PR] the engine currently *is* the orchestrator | Partial | B5: the engine becomes a validator and replay tool, not the runner |

---

## (b) Brief for a Cursor cloud agent (final, ready to paste)

```
Repo: vishamathur/mvp-releasedesk. Work on the existing branch cursor/desk-e2e-handover-6823 (PR #36). Push normal commits. Do NOT merge, do NOT force-push, do NOT commit secrets, do NOT set RELEASEDESK_CLOUD_CLIENT=real anywhere in CI (it stays mock), keep the red_team|security iteration gate and the ATLAS/OWASP merge block. Follow AGENTS.md and .cursor/rules/*.

Goal: Release Desk orchestration moves out of app code and onto six live Grok Bot teammates: Lead, Change Analyst, Standards, Security, Builder, and the Release Desk Log audit bot. The repo becomes (1) the spec and bot pack the bots run from, (2) a validator plus a read-only trace view built from the Log bot's JSONL, and (3) the shipped Grok API code path. Human gates are raised by the bot that owns the work, never by Lead. Chat only, no Slack.

B1. Bot pack
- Add grok-bots/personas/{lead,change-analyst,standards,security,builder}.persona.md and .onboarding.md, grok-bots/personas/validate-handoff.skill.md and grok-bots/personas/log.persona.md (all attached; copy verbatim).
- Replace grok-bots/bots/*/PERSONA.md, skills/*.md and routines/*.md so they match: skills validate-handoff, open-request, advance-stage, estimate-change, discovery-and-scope, draft-proposal, check-compliance, security-review, launch-cursor-build, raise-human-gate; routines stalled-requests, pending-consults, watch-build. Delete change-analyst/routines/on-pr-opened.md and lead/routines/on-demand-release.md. Add grok-bots/bots/log/PERSONA.md.
- grok-bots/registry.json: keep the five ids; add {"definitionId":"log","host":"grok-bot-app","grokBotAppAgentId":"3824a7e2-512f-4a5b-a0bd-5202fd8dffbd","grokBotAppName":"Release Desk Log","liveBotId":null,"status":"created_in_grok_bot_app"}. Add grok-bots/definitions/log.json. Update any registry/definition tests.
- Remove Slack from every connector list and persona in the repo.

B2. Spec PID v1.1.0 (gate owners, chat only)
- grok-bots/processes/pid-er.v1.json and pid-nc.v1.json: "version": "1.1.0". Owners: proposal -> change-analyst (consulting ["standards"]), finance-approval -> change-analyst (consulting []), release-gate -> builder (consulting ["security","standards"]). security-compliance-approval stays security. test-gate stays lead with humanApprover null. Add top-level "gateRaisedBy": "stage-owner" and "auditLog": {"bot":"log","agentId":"3824a7e2-512f-4a5b-a0bd-5202fd8dffbd","dirEnv":"RELEASEDESK_LOG_DIR"}.
- entry.channel = "lead-chat" for both PIDs (remove #er-intake, #new-customer, #release-desk). In entry.criteria replace "Posted in #…" with "Started in Lead's chat with the intake card".
- processes.ts: extend ProcessDefinitionSchema for gateRaisedBy, auditLog and entry.channel "lead-chat". schema.ts: THREAD_CHANNELS = ["lead-chat"].
- docs/sdlc/overview.md, PID-ER.v1.md and PID-NC.v1.md (keep the filenames; content says v1.1.0): owner table, mermaid, a "Human gates" table (gate, approver role, raising bot), "Channels: chat only", and an "Audit log" section.

B3. Protocol and engine: approval only through the owning bot's human gate
- grok-bots/protocols/handoff.v1.json, handoff.v1.md and stage-transition.v1.json: version "1.1.0" (message field v stays 1). Replace "A bot never sets approved" with: "A bot never decides a gate. The stage owner of a gate stage may send stage-return with humanGate.status approved|rejected only when copying a human reply: decidedBy is a human name, and note is '<ISO-8601 time> | verbatim: <reply>'. Lead rejects anything else." Add: "Every bot copies Release Desk Log (priority false) on each message sent or received, each REJECT, and each gate ask/decision; Lead also copies each stage transition. The Log never routes or approves." Remove #release-desk mirroring.
- schema.ts validateHandoffMessage: allow non-pending humanGate only when kind=stage-return, action=return, to=lead, from = owner of that stage, humanGate.gate = stage, isHumanActor(decidedBy), and note matches /^\d{4}-\d{2}-\d{2}T[^|]+\| verbatim: .+/. Otherwise bot_cannot_approve. New code gate_owner_mismatch when from != the stage owner. "log" is never a valid from/to.
- engine.ts: Lead no longer posts gate cards. On a gate stage it sets ready-for-human, sends stage-handoff to the owner, and accepts the owner's stage-return with the decision (copy it into transition.humanDecision and pid.decisions). Remove #release-desk posts. recordHumanDecision stays only as a test/simulation helper that produces the owner return; it must not be reachable from the Desk UI.
- bots.ts mocks: Change Analyst, Security and Builder produce the gate card and, in tests only, a "MOCK human" decision. The simulation emits Log lines (B5 format) so replay and live use the same format.
- handoff.test.ts: add an owner return with a valid human decision (accepted); a non-owner returning a decision (gate_owner_mismatch); decidedBy = a bot slug (bot_cannot_approve); a missing verbatim/time note (bot_cannot_approve); Lead sending an approved humanGate (bot_cannot_approve); a thread.channel other than lead-chat (invalid_schema); from or to = log (unknown_sender/unknown_recipient); and full PID-ER and PID-NC chains with owner-raised gates at pidVersion 1.1.0.

B4. Diagram and slides
- Add docs/diagrams/release-desk-handover-diagram.{svg,png} and scripts/render_handover_diagram.py (attached). Link them from docs/sdlc/overview.md and docs/spacexai-slide-2-architecture.md, and update slide 2 to the bot-native architecture (six teammates, Log bot, chat only).

B5. Desk = read-only trace view over the Release Desk Log JSONL
- New packages/releasedesk-core/src/handoff/log.ts:
  LogLineSchema (zod) for one line: {requestId, seq:int, at: ISO-8601 with offset, event: "sent"|"received"|"reject"|"gate-ask"|"gate-decision"|"transition"|"note"|"anomaly", pid, pidVersion, from, to, kind?, stage?, action?, summary, gate?, gateOwner?, decidedBy?, verbatim?, rejectCode?, confirmations?: string[], anomalies?: string[], message?: object (the handoff.v1 copy)}.
  readLogDir(dir): read *.jsonl, skip and report malformed lines (one bad line never throws), sort by seq, and group by requestId.
  buildTrace(lines): timeline, current stage (the last transition), gate decisions (who, when, verbatim) and anomalies. Re-validate each embedded handoff.v1 message with validateHandoffMessage and mark failures.
- Source: env var RELEASEDESK_LOG_DIR (absolute path; on the shared box it is /workspace/releasedesk-log). When unset, show an empty state that names the variable. Import path: a file picker on /handoff that loads .jsonl files client-side for viewing only (no upload, no server writes).
- apps/releasedesk API: keep GET /api/handoff (list requests from RELEASEDESK_LOG_DIR) and GET /api/handoff/[requestId] (trace) only. Delete the POST routes under app/api/handoff/** (create, message, decision). /handoff and /desk render HandoffBoard from the trace: a lane per bot, events, gate decisions and anomalies. Keep the old simulation as a "Replay (MOCK)" toggle that renders fixture JSONL only. Copy: "Bots run the process; Release Desk Log records it; Desk shows it."
- Fixtures: apps/releasedesk/test/fixtures/releasedesk-log/REQ-2026-0001.jsonl (full PID-ER run, steps 1–42 of the diagram, including one REJECT bot_cannot_approve and one anomaly), REQ-2026-0002.jsonl (PID-NC through the proposal gate), and one file with a malformed line. Vitest for log.ts and the GET routes with RELEASEDESK_LOG_DIR pointed at the fixtures.
- .gitignore: releasedesk-log/ (real logs are never committed).

B6. Real Grok API call path in the workflow (secret approved by Vishal)
- Keep apps/releasedesk/src/lib/grok-release-intel.ts as the single Grok client (exclusive RELEASEDESK_GROK_API_KEY_LEAD; MOCK label when it is absent; trustCheck.humanGateStillRequired and noAutoApprove stay true). Use strict JSON-schema structured output: classify + summarize + riskTier (low|medium|high) + blockers[].
- Add scripts/release-intel-pr.ts: read the PR's changed paths and title (GitHub API with GITHUB_TOKEN), call grok-release-intel, and print JSON.
- Add .github/workflows/release-intel.yml on pull_request (never pull_request_target), with permissions contents: read, pull-requests: write. It runs the script with env RELEASEDESK_GROK_API_KEY_LEAD: ${{ secrets.RELEASEDESK_GROK_API_KEY_LEAD }} and creates or updates one PR comment headed "release-intel v1" with the JSON. A missing secret (for example, forks) gives a MOCK-labelled comment and the job stays green. Do not add or change RELEASEDESK_CLOUD_CLIENT. Never echo the key.
- Vitest for the script with a mocked fetch. Document in AGENTS.md that Builder copies the release-intel result into build-result.testsSummary and that Security uses riskTier/blockers at the test gate.

B7. Verify and report
- npm ci && npm test && npm run lint && the typecheck commands in .github/workflows/ci.yml. All existing tests still pass. grep shows no #er-intake, #new-customer, #release-desk or Slack left in grok-bots/, docs/sdlc/ or apps/releasedesk/src.
- Replace the PR #36 description with the attached text (section c). Report commit SHAs, test counts and CI status. Do not merge.
```

**The parent must attach these when launching:** the five `*.persona.md` and `*.onboarding.md` files, `validate-handoff.skill.md`, `release-desk-handover-diagram.{svg,png}` and `render_handover_diagram.py` from `/workspace/grokbot-native/`, plus the Release Desk Log persona text (the parent created it; it isn't in this folder). The cloud agent cannot read the box.

**Human step (Vishal, approved):** add the repository Actions secret `RELEASEDESK_GROK_API_KEY_LEAD` in GitHub → Settings → Secrets and variables → Actions. The key should never be pasted into chat or a file.

**Rollout order:** all drafts here already use v1.1.0, `lead-chat` and the Log cc rule, so the bots can be onboarded before PR #36 changes. The repo validator matches them only after B2 and B3 land.

---

## (c) Draft PR #36 description

```
## Release Desk runs on Grok Bot teammates (PID-ER / PID-NC v1.1.0)

Five Grok Bot teammates (Lead, Change Analyst, Standards, Security, Builder) now run the SDLC themselves by sending each other handoff.v1 messages in chat. A sixth, Release Desk Log, records every handover as append-only JSONL. This repo holds the spec they run from, the validator, the read-only trace view over the Log, and the Grok API code the Builder's cloud agent ships.

### What changed
- Bot pack: personas, onboarding, skills and routines for all five bots (grok-bots/personas/, grok-bots/bots/*).
- Gates are raised by the bot that owns the work: proposal and finance (Change Analyst), security-compliance / iteration gate (Security), release (Builder). Vishal's reply is recorded verbatim with a time and returned to Lead. Lead is the only writer of pid.state and rejects any approval without a human decision.
- Validator and engine enforce gate ownership (gate_owner_mismatch, bot_cannot_approve), with new tests.
- Desk is now a read-only trace built from Release Desk Log JSONL (RELEASEDESK_LOG_DIR or file import); the simulation is kept as "Replay (MOCK)" over fixtures.
- Chat only: Slack channels removed; thread.channel = lead-chat.
- Grok API in the workflow: release-intel workflow posts a structured classify/summarize/riskTier result on each PR; Builder carries it into build-result and Security/Lead act on it at the test gate.
- New handover diagram: docs/diagrams/release-desk-handover-diagram.png.

### Requirement traceability
| # | Requirement | Satisfied by | Status |
| --- | --- | --- | --- |
| R1 | Lead + ≥3 specialists, clear roles | 5 teammates; grok-bots/personas/*, registry.json | Done once personas are applied |
| R2 | Bots hand work to each other | handoff.v1 over teammate messages; schema.ts validator | Done (spec) / live run pending |
| R3 | Channels | Lead chat as the request thread; gates in the owner bot's chat; teammate messages; Release Desk Log as the audit channel | Done (design) |
| R4 | Routines | stalled-requests, pending-consults, watch-build | In bots |
| R5 | Connectors | GitHub (all), Cursor CloudAgent (Builder) | Partial |
| R6 | Skills | validate-handoff, raise-human-gate, launch-cursor-build, … | In bots |
| R7 | Memory | Lead pid.state/transitions/decisions; specialist slices; Release Desk Log JSONL as shared history | In bots + Log |
| R8–R10 | Bot launches a cloud agent guided by repo rules/skills and brings the result back | Builder launch-cursor-build → PR + checks → build-result; AGENTS.md, .cursor/rules/releasedesk-grok-api.mdc, .cursor/skills/ship-grok-release-intel | Live run pending |
| R11 | Shipped code calls the Grok API doing real work | apps/releasedesk/src/lib/grok-release-intel.ts, scripts/release-intel-pr.ts, .github/workflows/release-intel.yml (Actions secret RELEASEDESK_GROK_API_KEY_LEAD) | Done once the secret is added |
| R12 | Human approval points | Owner-raised gates; verbatim decisions; Lead validation | Done (code) |
| R16/R18 | Trigger-to-output walk; trust checks | Desk trace from the Log JSONL, reject codes, anomaly flags, trustCheck, CI | Done (code) |
| R20 | Slides | docs/spacexai-slide-1-problem.md, slide-2 with the new diagram | Partial |

### Guardrails
No merge, no force-push, no secrets committed (the Grok key lives only in Actions secrets); CI keeps RELEASEDESK_CLOUD_CLIENT=mock; iteration gate red_team|security and the ATLAS/OWASP merge block unchanged.

### Test plan
- npm test, lint and typecheck (CI)
- New handoff tests for owner-raised gates and lead-chat
- log.ts and /api/handoff tests over the fixture JSONL (RELEASEDESK_LOG_DIR)
- One live PID-ER run with the five teammates (see the demo script)
```

---

## Decisions (resolved)
1. **Desk trace source:** Release Desk Log JSONL in `/workspace/releasedesk-log/{requestId}.jsonl`, read with `RELEASEDESK_LOG_DIR` or a file import (B5).
2. **Grok key in CI:** yes. Repo Actions secret `RELEASEDESK_GROK_API_KEY_LEAD` for the release-intel PR check; `RELEASEDESK_CLOUD_CLIENT` stays mock (B6).
3. **Version:** bump PID-ER, PID-NC and the protocol docs to 1.1.0 (B2, B3). All bot drafts already use 1.1.0.
4. **Channels:** chat only, no Slack. The thread is Lead's chat plus the Log bot; `thread.channel` = `lead-chat` (B2).
