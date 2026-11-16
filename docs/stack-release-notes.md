# Release Desk — Stack release notes (PRs #1–#16)

Last updated: 2026-11-17 (Asia/Calcutta)

Summaries of each stacked contribution toward the Northwind KYC / Release Desk MVP. Primary merge path grows bottom-up toward tip **#16**; **#10** is a parallel branch off #8 (agile hardening) and is not on the tip ancestry.

Architecture: [`architecture-mermaid.md`](./architecture-mermaid.md). How to run: repo root README.

---

## Stack map (tip ancestry)

```
#1 → #2 → #4 → #5 → #6 → #7 → #8 → #9 → #11 → #12 → #13 → #14 → #15 → #16
                              ↘ #10 (parallel off #8)
```

*(No PR #3 exists in this repository.)*

---

## #1 — Milestone 1: Northwind Bank KYC application

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/1 · `cursor/northwind-kyc-milestone-1-28df` → `main`

Working KYC onboarding demo at `apps/kyc` (Next.js monorepo). Identity → mocked document placeholders → local risk score → analyst review. Seed data, domain tests, GPL-3.0. No agents yet.

---

## #2 — Milestone 2: shared run context and agent contracts

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/2 · stacked on #1

Package `@releasedesk/core`: run/task/evidence/audit IDs, Zod contracts for Lead + specialists, parallel-safe task model, in-memory/file stores, `MOCK:` labeling. Contracts only — no runners/UI.

---

## #3 — *(none)*

No pull request with number 3 in `vishamathur/mvp-releasedesk` (numbering jumps #2 → #4).

---

## #4 — Milestone 3: Lead Agent orchestrator

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/4 · stacked on #2

Package `@releasedesk/lead`: pluggable `AgentRunner`s (MOCK stubs by default), parallel analysis wave, retry/remediation structure, human merge/release gates (never auto-approved), readiness consolidation, DM text + MOCK voice, `check:release` CLI.

---

## #5 — Milestone 4: Specialist agents

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/5 · stacked on #4

Package `@releasedesk/specialists`: real Change Analyst, Standards, Security, and Builder runners writing independent results into shared context. Local git/policies/advisory fixtures with `MOCK:` when live APIs unavailable. Builder plans Cloud Agent handoffs (not yet dispatched).

---

## #6 — Milestone 5: Builder → Cursor Cloud Agents

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/6 · stacked on #5

Cloud Agent pipeline **Coding → Testing ∥ Review**. MOCK client default (CI-safe); optional real client via `CURSOR_API_KEY` + `RELEASEDESK_CLOUD_CLIENT=real`. Tracks branch / tests / PR metadata. Never auto-merges.

---

## #7 — Milestone 6: Verification loops and PR workflow

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/7 · stacked on #6

Lead checkpoints (`specialist_analysis`, `cloud_agents`, `post_remediation`), remediation → reverify loops, MOCK/real GitHub PR open/track/poll, explicit human merge/release gates. `mergePullRequest` always refused.

---

## #8 — Milestone 7: Release Desk UI and demo scenarios

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/8 · stacked on #7

App `apps/releasedesk` on port 3001: on-demand checks, run detail (specialists, checkpoints, cloud handoffs, PRs, audit), human approve/reject, demo scenarios from real orchestrator/fixtures. MOCK voice only.

---

## #9 — Architecture Mermaid docs

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/9 · stacked on #8

Docs-only: `docs/architecture-mermaid.md` — simplified two-lane diagram (SDLC · Release Desk vs App · Northwind KYC).

---

## #10 — Agile SDLC hardening (parallel off #8)

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/10 · base `cursor/release-desk-ui-2ceb` (**not** on tip path to #16)

Adds automated testing gates, release-notes package, rollback plan (manual), and observability hooks + UI panels. Feature sign-off deferred to #11.

---

## #11 — Mandatory feature sign-off checklist

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/11 · stacked on #9

Per-feature developer checklist for AI-produced code before merge/release readiness. Extends (does not replace) run-level merge/release gates. Never auto-signed. Core contracts + Lead detection + Desk UI panel.

---

## #12 — Mandatory Security on every change

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/12 · stacked on #11

Security always scheduled; readiness blocked without a recorded Security result (no low-risk skip). MITRE ATLAS + OWASP LLM Top 10 hard guardrails: fail Security; block merge on review-ready PRs (drafts exempt); human waiver only — never auto-waived/merged.

---

## #13 — Multi-customer intake backlog with dual approvals

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/13 · stacked on #12

Customers/`customerId`, cost estimates, weighted multi-customer backlog, per-customer views, dual human cost + queue approvals, re-prioritize sign-off. Lead starts only from fully approved items. Intake UI + docs.

---

## #14 — Optional Zscaler AI Red Teaming provider stub

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/14 · stacked on #13

Shared `AiRedTeamingProvider` in core (`custom` | `zscaler` via `RELEASEDESK_AI_RED_TEAM_PROVIDER`). Zscaler without credentials → MOCK findings; with credentials → `not_wired` (no live API). Docs + tests. No Zscaler subscription required for MVP.

---

## #15 — AI Red Teaming specialist with realtime Lead flags

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/15 · stacked on #14

Role `ai_red_teaming` (distinct from Security): cross-cutting AI/prompt guardrails, realtime Lead flags, post-Builder pass, ATLAS/OWASP hard block (review-ready; drafts exempt). Reuses #14 provider contract.

---

## #16 — Distinct Testing and Verification stages (MVP tip)

**PR:** https://github.com/vishamathur/mvp-releasedesk/pull/16 · stacked on #15

First-class **Testing** (Cloud Testing Agent) and **Verification** (independent quality check) stages after Coding and before checkpoints. Verification does not auto-pass merely because Testing ran. README MVP runbook + Cursor SDLC guidance. Completes the tip of the main MVP stack.

---

## Cumulative MVP outcome (tip #16)

| Area | Status at tip |
| --- | --- |
| Northwind KYC app | #1 |
| Shared contracts + stores | #2 |
| Lead orchestration | #4–#7, #11–#16 |
| Specialists + Cloud Agents | #5–#6 |
| Desk UI + demos | #8 (+ #11 intake/sign-off UI) |
| Intake dual gates | #13 |
| AI Red Teaming + optional Zscaler | #14–#15 |
| Distinct Testing / Verification | #16 |
| Architecture docs | #9 (+ later overwrites) |

Optional / parallel: agile gates/notes/rollback/observability on **#10** (merge separately if desired).
