# SpaceXAI brief — two slides (exact wording + Wednesday recommendation)

**Brief image:** `docs/spacexai-challenge-brief.jpg`

## Exact brief wording (slides)

From **Prep & Resources / Slides** on the brief:

1. **Problem statement and assumptions**
2. **Architecture diagram**
3. **(Optional)** Trade-offs and “what's next.”

From **Expectations / Assets** (same brief):

- **Two slides (mandatory), with an optional third.**
- **Most time should be in the live system.**
- Style cue: “Tell the story, show it live, land the value.”

From **Session** (framing the first slide’s job):

- Frame the business problem: **who feels it, what it costs, and who buys the fix.**

Constraint implied by the whole brief: slides are **short framing only** — not the demo. Live system carries agent navigation, gate proof, and Grok API depth.

---

## What Release Desk already has

| Brief ask | Have today | Gap |
| --- | --- | --- |
| Slide 1 — Problem + assumptions | Partial narrative in `demo-recording-script.md` framing (B1) and Space 1 KYC story; **no dedicated problem/assumptions slide deck** | Need a one-pager slide |
| Slide 2 — Architecture diagram | Strong: `demo-architecture-diagram.md` (Mermaid, PR #14 gate spine) + `architecture-mermaid.md` / PR #9 | Must **relabel** agents as **Grok Bots** + show **Grok API** + Cursor triad; current diagram still says “Ephemeral Cloud Agents — MOCK by default” and Lead as Desk runner |
| Optional slide 3 — Trade-offs / next | Script mentions PR #15 gap; not a slide | Skip Wednesday unless asked |
| Most time live | `demo-recording-script.md` is **20 min** and opens on architecture then gate; agents are segment H (~3:45) | Rebalance: **agent navigation first** (hiring-manager ask), then gate, then Grok API depth |

---

## Recommended two slides (Wednesday)

### Slide 1 — Problem statement and assumptions
**Title:** Northwind KYC release readiness — the problem  
**One-liner content:** Delivery managers can’t tell if a KYC release is safe to ship; late security/policy blockers burn release windows.  
**Assumptions (3 bullets max on slide):**  
1. Space 1 — software delivery & release readiness.  
2. Humans keep merge/release authority (bots advise; gates decide).  
3. Required stack: Grok Bot host + Cursor cloud agent + Grok API in the shipped path.

**Say (≤45s):** who feels it (DM), what it costs (missed window / rework), who buys (eng + risk leaders). Then: “Slide two is the map — then we live in the bots.”

### Slide 2 — Architecture / workflow
**Title:** Release Desk — Grok Bot → Cursor → Grok API  
**One-liner content:** Lead + three specialists hand off asynchronously; Builder launches Cursor; shipped code calls Grok API; iteration gate needs red team **or** security before humans merge/release.  
**On-diagram callouts only:**  
- Grok Bot lane (Lead · Change Analyst · Standards · Security · Builder)  
- Cursor Coding ship path → Grok API intel  
- `evaluateIterationProceedGate` (approve / reject)  
- Human merge + release  

**Source to adapt:** paste Mermaid from `demo-architecture-diagram.md`, but rename “Ephemeral Cloud Agents” → “Grok Bots + Cursor” and add a Grok API box on the shipped Desk path. Drop or shrink intake/checklist boxes for Wednesday clarity.

**Optional slide 3 (skip unless Q&A):** Trade-offs — MOCK without keys; live x.ai/bot import vs Desk pack browser; PR #15+ live Lead wiring.

---

## Fit to balanced demo flow

| Demo beat (hiring manager + brief) | Slide role |
| --- | --- |
| Open | **Slide 1** (problem) → **Slide 2** (map) — ≤3 minutes total |
| Spine: look / pull up / move agent→agent / deep-dive Security | **Live Desk** `GrokBotsPanel` — no more slides |
| Proof: red team gate approve/reject | **Live** `IterationApprovalGate` — point back to gate box on Slide 2 with cursor if needed |
| Depth stop: Grok API classify/extract/score/summarize + trust check | **Live** Grok intel panel — “this is what Cursor ships” |
| Live edit + Q&A | Stay in bots/repo — optional slide 3 only if they ask “what’s next” |

**Do not** rebuild the 20-min script as architecture-first for Wednesday; keep slides short, then **agent navigation spine** owns the room.
