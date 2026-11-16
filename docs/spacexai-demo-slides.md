# SpaceXAI demo — two slides (+ optional third)

Speaker notes for a ≤3-minute open, then live system.  
Canonical store copy also lives at the Project docs store.

**Live control plane (enterprise path):** `npm run desk` → http://localhost:3001/control · `npm run demo:control-plane`

---

## Slide 1 — Problem statement and assumptions

**Title:** SDLC optimization for multi-customer IT services

**Problem statement:** An IT services organization delivering applications to many clients needs faster, safer release cycles across the portfolio. Late security and policy findings burn delivery windows, and decision-makers lack a single trusted view of what is safe to ship versus still blocked.

**Who feels it:** Delivery and release owners responsible for multiple client applications.

**What it costs today:** Slipped windows, repeated specialist chase-down, and no consolidated readiness signal before merge and release.

**Who buys the fix:** Engineering and risk leaders who want speed without giving up human authority on critical decisions.

**Assumptions**
1. Space 1 focus — software delivery and release readiness across a multi-customer portfolio.
2. Bots advise and orchestrate; humans keep merge and release authority.
3. Required stack: Grok Bot (Lead + specialists) → Cursor cloud agent ships real repo changes → shipped code calls Grok API for workflow intel.
4. MOCK only when credentials are absent; the live path is designed and rehearsed for the room.

**Business requirements (IT services org)**
1. **Agility** — shorter, safer release cycles across many client apps.
2. **Security** — catch policy and security blockers early enough that they do not blow the delivery window.
3. **Token optimization = cost / margin** — in an ITS organization every token is a line item on a client invoice; lean orchestration protects margin while still producing auditable readiness.

**Spoken (≤45s):**  
“IT services org, many client apps — we need faster, safer releases across the portfolio. Late findings burn windows, and nobody has one answer for safe to ship. Three drivers: agility, security, and token optimization as cost and margin control — every token hits a client invoice. Humans keep merge authority. Slide two is the map — then we go live.”

---

## Slide 2 — Architecture / workflow

**Title:** SDLC control plane → back to Lead

**One-liner:** Intake → Grok Bots → Cursor ships → Grok API → human gates → Lead. Detail lives in code + `/control`; this slide is the room map.

```mermaid
flowchart LR
  subgraph W1["WIRE 1 · Intake"]
    A["Customer ER"] --- B["Cost / finance"] --- C["Priority queue"]
  end

  subgraph W2["WIRE 2 · Grok Bots"]
    D["Lead"] --- E["CA"] --- F["Standards"] --- G["Security"] --- H["Builder"]
  end

  subgraph W3["WIRE 3 · Cursor + Grok API"]
    I["Coding"] --- J["Testing"] --- K["Review"]
    I --> L["Grok API intel"]
  end

  subgraph W4["WIRE 4 · Humans"]
    M["Iteration gate"] --- N["Merge"] --- O["Release"]
  end

  C ==> D
  H ==> I
  L ==> M
  O ==>|"readiness"| D
```

**On-slide callouts (say, don’t draw)**
1. Security mandatory; ATLAS/OWASP on review-ready PRs  
2. Coding ships; Testing/Review never merge; exclusive NHI keys  
3. Iteration gate = red_team OR security; never auto-merge  

**Detail diagram:** [`architecture-mermaid.md`](./architecture-mermaid.md) (full ER / ATLAS / side-queue) · Live: `/control`

**Spoken (≤40s):**  
“Intake into Lead, specialists hand off, Cursor Coding ships code that calls Grok API, humans gate iteration and merge, then readiness closes the loop. Detail is in `/control` — let’s open it.”

---

## Optional Slide 3 — Trade-offs / what’s next

**Chose not to build (yet):** Full production bot-import UI; always-on pollers; auto-approve of production merges; deep audit-tour as the primary demo beat.

**With more time:** Live Lead wiring on every iteration; real Cursor agent runs without MOCK; stronger trust harness for Grok API outputs; enterprise SSO and secrets rollout.

**Skip unless they ask “what’s next.”**

---

## After the slides (live)

Use [spacexai-room-runbook.md](./spacexai-room-runbook.md) for commands + clicks + MOCK vs live matrix.
