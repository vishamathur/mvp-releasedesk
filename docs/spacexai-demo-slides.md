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

**Title:** Full SDLC control plane → back to Lead

**One-liner:** Customer ER + finance + priority → Lead + specialists → ATLAS/OWASP → Cursor Coding/Testing/Review → Grok API → human gates → readiness + tokens/NHI back to Lead. Full workflow — nothing dropped.

```mermaid
flowchart TB
  subgraph Intake["1 · Multi-customer intake · ER · finance · priority"]
    Cust["Customer<br/>unique customerId"]
    Req["CustomerRequest<br/>priorityHint"]
    Cost["CostEstimate<br/>finance · keyed by customerId"]
    Queue["Weighted multi-customer backlog<br/>fairness interleave"]
    Views["Per-customer views"]
    CostGate["Human cost approval"]
    QGate["Human queue approval"]
    RePri["Re-prioritize + quick sign-off"]
    Cust -->|1..*| Req
    Req -->|1..1| Cost
    Req --> Queue
    Queue --> Views
    Cost --> CostGate
    Queue --> QGate
    CostGate --> RePri
    QGate --> RePri
  end

  subgraph GrokBots["2 · Grok Bots"]
    Lead["Lead Bot · orchestrates"]
    CA["Change Analyst"]
    Std["Standards"]
    Sec["Security · mandatory every change"]
    Bld["Builder"]
    Lead --> CA
    Lead --> Std
    Lead --> Sec
    Sec --> Bld
  end

  subgraph RedTeam["3 · ATLAS / OWASP · AI Red Teaming"]
    AIRed["AI Red Teaming<br/>all AI/prompt touchpoints"]
    Zscal["Zscaler provider · optional MOCK"]
    Collapsed["Collapsed gate<br/>pre_release + post_remediation"]
    SideQ["Remediation side-queue<br/>non-blocking"]
    Atlas["ATLAS / OWASP LLM Top 10<br/>hard-block review-ready PRs"]
    AIRed --> Collapsed
    AIRed -.-> Zscal
    Collapsed -.-> SideQ
    Collapsed --> Atlas
  end

  subgraph CursorLane["4 · Cursor cloud agents · exclusive NHI"]
    Coding["Coding · ships repo change"]
    Testing["Testing · verifies · never merge"]
    Review["Review · reviews · never merge"]
    NHI["NHI keys<br/>RELEASEDESK_CURSOR_API_KEY_*"]
    Coding --- NHI
    Testing --- NHI
    Review --- NHI
  end

  subgraph GrokAPI["5 · Grok API · shipped code"]
    Intel["Classify / extract / score / summarize"]
    Trust["trustCheck<br/>humanGateStillRequired · noAutoApprove"]
    LeadKey["NHI · RELEASEDESK_GROK_API_KEY_LEAD"]
    Intel --> Trust
    Trust --- LeadKey
  end

  subgraph Humans["6 · Human gates"]
    Iter["Iteration gate<br/>red_team OR security"]
    FeatSO["Feature sign-off checklist"]
    Merge["Human merge approval"]
    Rel["Human release approval"]
    Iter --> FeatSO --> Merge --> Rel
  end

  subgraph Efficiency["7 · Token efficiency · portfolio"]
    Portfolio["DEMO_PORTFOLIO<br/>Northwind · Contoso · Fabrikam"]
    Slice["Role context slices<br/>vs full-run packing"]
    Margin["Token = invoice line item<br/>ITS margin"]
    Portfolio --- Slice --- Margin
  end

  subgraph APP["App · Northwind KYC"]
    KYC["KYC UI + API + domain"]
  end

  RePri -->|"approved_for_dev only"| Lead
  CA & Std & Sec & Bld -.->|AI output| AIRed
  AIRed -.->|realtime flags| Lead
  Bld -->|"hand off + context"| Coding
  Coding --> Testing
  Coding --> Review
  SideQ -.->|async remediate| Coding
  Coding -->|"ships"| Intel
  Coding & Testing & Review -.->|prompts| AIRed
  Atlas --> Iter
  Trust --> Iter
  Rel -->|"readiness / result"| Lead
  Intel -.->|"structured intel"| Lead
  Slice -.->|lean prompts| Lead
  CA -.-> KYC
  Sec -.-> KYC
  Coding ==>|build + verify| KYC
  Rel -.->|gate release of| KYC
```

**On-slide callouts**
1. **Intake** — Customer ER · CostEstimate finance · dual approvals · fairness priority → Lead  
2. **Bots + ATLAS** — Lead·CA·Standards·Security·Builder; collapsed AI Red Team; hard-block review-ready PRs  
3. **Cursor + Grok API** — Coding ships; Testing∥Review never merge; classify/extract/score/summarize + trustCheck; exclusive NHI  
4. **Full circle** — iteration → feature sign-off → merge/release → readiness + token slices **back to Lead**

**Live map:** `/control` (7 stages) · `/mvp` · `/agents` · `/desk` · [`architecture-mermaid.md`](./architecture-mermaid.md)

**Spoken (≤60s):**  
“Full stack: customers, cost, and priority into Lead; specialists and ATLAS; Cursor Coding ships while Testing and Review stay independent; Grok API intel; humans on iteration and merge. Readiness and token efficiency close the circle back to Lead. Now we open `/control`.”

---

## Optional Slide 3 — Trade-offs / what’s next

**Chose not to build (yet):** Full production bot-import UI; always-on pollers; auto-approve of production merges; deep audit-tour as the primary demo beat.

**With more time:** Live Lead wiring on every iteration; real Cursor agent runs without MOCK; stronger trust harness for Grok API outputs; enterprise SSO and secrets rollout.

**Skip unless they ask “what’s next.”**

---

## After the slides (live)

Use [spacexai-room-runbook.md](./spacexai-room-runbook.md) for commands + clicks + MOCK vs live matrix.
