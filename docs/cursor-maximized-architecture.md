# Cursor-maximized architecture (MR-24)

Last updated: 2026-11-17 (Asia/Calcutta)

**Goal:** Maximize Cursor capabilities; minimize self-managed infra. Diagram: [`architecture-mermaid.md`](./architecture-mermaid.md).

**Checkout base:** tip `#17` / `cursor/cursor-maximized-architecture-0b4f`. Sibling **MR-23** implements Lead/specialists as Cloud Agents (on-demand Desk→Lead, shared store, per-agent NHI API key slots) on this tip.

---

## 1) Revised architecture — which Cursor capability covers each layer

| Layer | Cursor capability | Notes |
| --- | --- | --- |
| **Release Desk UI** (intake, dual approvals, on-demand check, sign-off, merge/release gates) | **Cursor Apps** | Host internal ops UI; thin trigger into Cloud Agents API |
| **Northwind KYC** (UI + API + domain) | **Cursor Apps** | Demo/internal hosting via `publish-app`; optional Apps Postgres |
| **Lead Agent** | **Cloud Agents** (ephemeral) | Orchestrates wave; owned by MR-23 conversion (today: in-process Node) |
| **Change Analyst / Standards / Security / Builder** | **Cloud Agents** (ephemeral) | Same conversion; Security remains mandatory every change |
| **AI Red Teaming** | **Cloud Agents** (ephemeral) | Cross-cutting + post-Builder; ATLAS/OWASP hard block |
| **Coding / Testing / Review** | **Cloud Agents** (already) | Builder-dispatched via Cloud Agents API (`MOCK` default) |
| **Verification** | Lead Cloud Agent stage (independent) | Must not auto-pass because Testing finished |
| **Scheduled / PR / CI follow-ups** | **Automations** | Desk→Lead on-demand, triage, post-CI remediations |
| **Always-on-feeling coding sessions** | **Background agents** (= Cloud Agents surface) | Dashboard / API / mobile — not a separate product |
| **PR review assist** | **Bugbot** | Complements Review Cloud Agent; does not replace human merge |
| **Zscaler AI Red Teaming** | Optional **provider flag** only | Stub `MOCK` without credentials; live API = external if wired |

**Two lanes (see Mermaid):**

1. **SDLC · Release Desk** — intake → human dual approvals → ephemeral Cloud Agent pipeline → human merge/release.
2. **App · Northwind KYC** — Cursor App that Coding/Testing/Verification act on; release gated by Desk.

**Control-plane sketch (minimize self-host):**

```
Human / Automation / Desk App
        │
        ▼
 Cloud Agents API  ──► Lead CA ──► specialists ──► Builder
                              │                      │
                              │                      ▼
                              │            Coding → Testing ∥ Review
                              │                      │
                              ▼                      ▼
                     AI Red Teaming ◄──────── (prompts/outputs)
                              │
                              ▼
                     Verification → Desk App gates → GitHub merge
```

Self-hosted Cloud Agent **workers** remain an optional Enterprise placement for tool execution when code must stay in-network; Cursor still owns inference/orchestration (see Project store `docs/cursor-self-hosting-research.md`).

---

## 2) What still cannot run on Cursor (and where it lives)

| Concern | Why not on Cursor alone | Where it lives |
| --- | --- | --- |
| **Human merge / release authority** | Policy: never auto-merge from agents | Desk App UI + GitHub branch protection |
| **Dual intake approvals & feature checklist** | Durable human UX, not ephemeral VM | Desk **Cursor App** (+ run-context records) |
| **Durable shared run context / audit** | Ephemeral agents need shared store across VMs | Thin durable store: Apps Postgres and/or existing `@releasedesk/core` file/DB backend — **not** “another agent fleet” |
| **Contracts / Zod schemas / readiness rules** | Library code, not a hosted Cursor service | Monorepo packages (`@releasedesk/core`, lead, specialists) cloned into agent workspaces |
| **Live Zscaler probing** | Third-party SaaS | External Zscaler API behind provider flag; stub stays MOCK |
| **Production KYC vendors** (OCR, sanctions, liveness) | Outside Cursor product | Customer/bank integrations (MVP remains MOCK-labeled) |
| **Full air-gapped Cursor control plane** | Not offered | N/A — inference stays Cursor cloud; use self-hosted **workers** only for execution |
| **SLA’d customer-facing KYC at bank scale** | Apps hosting quotas/SLA unpublished | Own infra when production-grade hosting is required; Apps fine for demo/internal |

**Still optional / out of band:** SPLX; live Zscaler subscription; real Cloud Agents via per-agent Cursor **named secrets** (MOCK default for CI; no external vault — see [`nhi-cursor-secrets.md`](./nhi-cursor-secrets.md)).

---

## 3) Fit of other Cursor features

| Feature | Fit |
| --- | --- |
| **Cloud Agents API** | Primary execution plane for Lead, specialists, Coding/Testing/Review, AI Red Teaming |
| **Cursor Apps** | Host Desk + KYC; publish from a Cloud Agent after security checks |
| **Automations** | Replace always-on Lead daemons with event/schedule triggers (Desk→Lead) |
| **Bugbot** | Extra PR review signal alongside Review Cloud Agent |
| **Background agents** | Operator alias for the same Cloud Agents product |
| **Self-hosted workers** | Optional execution placement; not required for MVP maximize-Cursor path |
| **CLI in GitHub Actions** | Restricted-autonomy CI edits; deterministic push/comment steps |

---

## 4) Transition note (today → target)

| Role | Today (tip #16) | Cursor-maximized target |
| --- | --- | --- |
| Coding / Testing / Review | Cloud Agents under Builder | Unchanged |
| Lead / CA / Standards / Security / Builder / AI Red Teaming | In-process Node `AgentRunner`s in Desk/CLI | Ephemeral Cloud Agents (MR-23) |
| Desk + KYC | Local Next.js (`npm run desk` / `dev`) | Prefer **Cursor Apps** publish; local remain for CI/dev |
| Zscaler | Optional MOCK stub | Same — flag off / MOCK; live external if ever wired |

Evidence for “today”: Project store `docs/lead-vs-cloud-agents-runtime.md`. Implementation of Lead/specialists as Cloud Agents is **out of scope for MR-24** (docs + Mermaid only).

---

## 5) Operator invariants (unchanged)

- Dual human approvals before Lead; no unapproved backlog into SDLC.
- Security mandatory on every change.
- AI Red Teaming distinct from Security; realtime flags to Lead; hard-block review-ready PRs (drafts exempt).
- Testing ≠ Verification.
- Feature checklist + merge + release are human gates; never auto-approved.
- Zscaler not required for MVP.
