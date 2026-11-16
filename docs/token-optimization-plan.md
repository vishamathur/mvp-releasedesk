# mvp-releasedesk — Agent token optimization plan

Last updated: 2026-11-16  
**Scope:** Tip `#16` / `cursor/testing-verification-stages-e619` + Cursor-maximized Cloud Agent target (MR-23/24).  
**Goal:** Cut LLM / Cloud Agent token spend without weakening Security, AI Red Teaming hard-block, Testing≠Verification, or human gates.  
**Method:** Measure tip fixtures + `check:release` payloads; estimate tokens ≈ `chars / 4`. Live Cloud Agent repo context dominates when `RELEASEDESK_CLOUD_CLIENT=real`.

---

## Baseline (measured on tip)

| Signal | Happy-path fixture | Remediation-loop fixture | Live MOCK `check:release` (e2e) |
| --- | --- | --- | --- |
| Full `report.run` JSON | ~22 KB (~5.5k tok) | ~52 KB (~13k tok) | larger (234 audit events) |
| `auditTrail` alone | ~12.6 KB (~3.2k tok) | ~28 KB (~7k tok) | dominant share of run |
| Tasks | 4 | 7 (+ reverify) | 17 specialist completions |
| AI Red Teaming tasks | 0 (happy stub path) | folded into waves | **~10** guardrail/post/hard_block passes |
| Demo fixture file | ~43 KB | ~103 KB | n/a |

**Per-run LLM budget (Cursor-maximized, remediation cycle, order-of-magnitude):**

| Band | Before (today’s packing habits × Cloud Agents) | After (all 6 areas) |
| --- | --- | --- |
| Conservative | ~180k tokens/run | ~95k tokens/run (**~−47%**) |
| Typical remediation | ~260k tokens/run | ~130k tokens/run (**~−50%**) |
| Worst (fat diff + 2 remediation cycles) | ~400k+ tokens/run | ~200k tokens/run (**~−50%**) |

Stacked areas are partially overlapping; do **not** sum %-cuts. Combined target: **~45–55% reduction** on a typical remediation run once Lead/specialists are Cloud Agents.

---

## Six optimization areas

### 1) Role-scoped run-context slices (not full `RunContext`)

**Problem:** Durable store is correct for persistence, but ephemeral Cloud Agents that reload the **entire** run (tasks + audit + metadata + nested evidence) burn tokens on every hop. Tip remediation run ≈ 52 KB; live runs with 200+ audit events are worse. Lead consolidations and specialist runners that stringify large `output` blobs amplify this.

**Before:** Each agent prompt may embed or re-read full `run` (~13k+ tok just for JSON, before instructions/repo).  
**After:** Per-role **context slice**: goal, target refs, this task input, peer **summaries** (≤N chars), open blocking issues, latest checkpoint, relevant evidence IDs — not full audit.

| Metric | Before | After |
| --- | --- | --- |
| Context JSON in specialist prompt | ~8–15k tok | ~1.5–3k tok |
| Lead consolidate prompt | ~10–20k tok | ~3–6k tok |
| **Est. savings** | — | **~25–35%** of non-Coding agent spend (~40–70k tok/run typical) |

**Steps:** (1) Add `projectRunContext(role, runId)` in `@releasedesk/core`. (2) Wire Lead / Cloud specialist dispatch to slices only. (3) Keep full run on disk/Postgres for audit UI. (4) Cap peer summary length (e.g. 400 chars).

---

### 2) AI Red Teaming pass coalescing

**Problem:** Cross-cutting guardrails fire **per touchpoint** (CA, Standards, Security, Builder, Coding, Testing, Review) plus post_builder + hard_block. E2E MOCK check produced ~10 AI RT tasks — each a separate agent invocation with `subjectText` (findings JSON + prompts + workItems).

**Before:** ~8–12 AI RT invocations/remediation cycle × ~3–8k tok ≈ **30–80k tok/run**.  
**After:** **Wave-batched** probes: one analysis-wave batch, one builder/cloud-wave batch, keep dedicated post_builder + hard_block. Same ATLAS/OWASP coverage; fewer model round-trips. Optional: skip re-probe when subject hash unchanged.

| Metric | Before | After |
| --- | --- | --- |
| AI RT invocations / remediation cycle | ~10 | ~4 (analysis batch, builder/cloud batch, post_builder, hard_block) |
| AI RT token share | ~30–80k | ~12–30k |
| **Est. savings** | — | **~55–65%** of AI RT tokens (**~20–50k tok/run**); **~10–20%** of total run |

**Steps:** (1) `runAiRedTeamingGuardrailsForAnalysisWave` → single batched provider call with touchpoint-tagged subjects. (2) Same for builder/cloud wave. (3) Preserve realtime Lead flags (emit per finding, not per empty pass). (4) Keep hard_block semantics unchanged.

---

### 3) Compact audit & evidence projections

**Problem:** Audit is ~50–55% of tip run JSON (28 KB / 52 KB on remediation-loop). Cloud Agents and Desk DM that dump `auditTrail` or nested `evidence[].data` (full cloud dispatch audits, handoffs) pay for history they do not need mid-flight.

**Before:** Full audit events with large `details` / nested `data`.  
**After:** Agents see **compact audit** (`action` + short `message` + ids only); UI/API offer `?projection=full|compact`. Evidence payloads store **uris/refs**; inline `data` capped (e.g. 2 KB) with overflow to artifact store.

| Metric | Before | After |
| --- | --- | --- |
| Audit in agent context | ~7k tok | ~1.5–2k tok |
| Evidence blobs in Builder output | multi-KB nested audits | refs + ≤2 KB inline |
| **Est. savings** | — | **~15–25%** of orchestration tokens (**~25–50k tok/run** when agents re-read store) |

**Steps:** (1) `compactAudit(events)`. (2) Desk `/api/runs/[id]` default compact. (3) Builder: stop embedding full `pipeline.audit` in evidence `data` (store separately). (4) Fixture generators use compact for demos where possible.

---

### 4) Specialist input budgets (diff / policy / advisory)

**Problem:** Change Analyst can ingest wide `git diff` ranges; Standards loads policy markdown; Security loads advisory fixtures + package graphs. Unbounded inputs dominate when base…head is the whole tip stack (~200 paths seen in e2e change analysis).

**Before:** Unbounded diff / full policy corpus / full advisory JSON in prompt path.  
**After:** Hard budgets: top-N paths by impact heuristic, diff char cap (e.g. 24k chars ≈ 6k tok), policy excerpts by path match, advisory correlation summary not raw CVE dump.

| Metric | Before | After |
| --- | --- | --- |
| Change Analyst prompt body | ~10–40k+ tok (diff-dependent) | ≤8k tok body + path index |
| Standards / Security prompt extras | full corpus possible | matched excerpts ≤4k tok combined |
| **Est. savings** | — | **~30–50%** of analysis-wave tokens (**~15–40k tok/run**); higher on fat PRs |

**Steps:** (1) Path allowlist + rank in `git-diff.ts`. (2) `MAX_DIFF_CHARS` / `MAX_POLICY_CHARS` env knobs. (3) Return `truncated: true` evidence when capped. (4) Tests for cap behavior.

---

### 5) Cloud Agent handoff prompt budgets + artifact refs

**Problem:** Builder builds Coding / Testing / Review handoff prompts with implementation instructions, goals, and acceptance criteria; real Cloud Agents also index the repo. Remediation cycles re-dispatch the trio. Nested AI RT already probes these prompts (area 2). Duplicating full instructions into every handoff + subjectText triples cost.

**Before:** Verbose multi-section prompts × 3 agents × cycles; instructions copied into AI RT subjects.  
**After:** Short handoff prompt (**≤2k tok**) + **artifact ref** (`instructionsUri` / store key) for full markdown; Testing/Review get criteria + changed-path list, not full Builder essay. Coding owns the long artifact once.

| Metric | Before | After |
| --- | --- | --- |
| Coding + Testing + Review prompt text | ~12–30k tok inline | ~4–8k tok inline (+ one artifact) |
| Per extra remediation cycle | ≈ same again | same budget, shared artifact versioned |
| **Est. savings** | — | **~40–60%** of Builder-dispatch prompt tokens (**~20–60k tok/run**); largest win when `CLOUD_CLIENT=real` |

**Steps:** (1) Persist `implementationInstructions` as run artifact. (2) Handoff prompts reference artifact id. (3) AI RT `subjectText` uses hash + excerpt ≤1k chars. (4) Document budgets in Cloud dispatch README.

---

### 6) Desk / CLI / demo projection layer

**Problem:** Demo fixtures embed full `report` (remediation ~68 KB report field). Desk DM / scenario loaders and `check:release --json` encourage feeding fat JSON into operator agents and future Automations. Regenerating demos also churns huge diffs (e2e observed).

**Before:** Full report + run in every demo; CLI prints full JSON by default when `--json`.  
**After:** **Projection profiles**: `summary` (readiness, blockers, checkpoint statuses, PR urls), `operator` (+ task summaries), `full` (debug). Demos ship `summary` + lazy `full` path; `--json` defaults to `operator`.

| Metric | Before | After |
| --- | --- | --- |
| Demo fixture on disk | 43–105 KB | 8–20 KB summary (+ optional full sidecar) |
| Tokens if Automation/agent loads demo | ~10–25k | ~2–5k |
| **Est. savings** | — | **~70–80%** of demo/CLI ingestion tokens; **~5–10%** of live run (operator path only) |

**Steps:** (1) `projectReport(report, profile)` in core. (2) `generate:demos` writes summary + full. (3) Desk scenario picker loads summary first. (4) README documents profiles.

---

## Combined rollout (step-by-step)

1. **Instrument** — Log prompt/char counts per agent role on MOCK + real (no behavior change).  
2. **Area 1 + 3** — Context slices + compact audit (safe, high leverage for Cloud Agent conversion).  
3. **Area 6** — Desk/CLI projections (unblocks smaller fixtures / cleaner Automations).  
4. **Area 4** — Diff/policy caps (protects fat-PR runs).  
5. **Area 5** — Handoff artifact refs (before scaling real Cloud Agents).  
6. **Area 2** — AI RT coalescing last (behavior-sensitive; keep hard_block tests green).  
7. **Verify** — Re-run tip e2e (`npm test`, `check:release` MOCK); compare token logs; confirm Security mandatory + Testing≠Verification + human gates unchanged.

**Do not optimize away:** mandatory Security participation, AI RT hard-block on review-ready PRs, feature checklist, dual intake approvals, merge/release human gates.

---

## Relation to architecture

Ephemeral Cloud Agents + durable store (see [`architecture-mermaid.md`](./architecture-mermaid.md), [`cursor-maximized-architecture.md`](./cursor-maximized-architecture.md)) make **projection at the store boundary** the primary token control — not shorter-lived VMs. Token budgets are an operator invariant alongside NHI secrets and MOCK defaults.

---

## Tracking

| Area | Primary owner package | Rough eng scope |
| --- | --- | --- |
| 1 Context slices | `@releasedesk/core` + lead dispatch | Medium |
| 2 AI RT coalesce | `@releasedesk/lead` + specialists | Medium (tests heavy) |
| 3 Compact audit/evidence | `@releasedesk/core` + Desk API | Small–medium |
| 4 Specialist budgets | `@releasedesk/specialists` | Small–medium |
| 5 Handoff artifacts | specialists `builder` / `cloud` | Medium |
| 6 Projections / demos | core + `@releasedesk/ui` + CLIs | Small |
