# Release Desk — Architecture (Mermaid)

Last updated: 2026-11-17 (Asia/Calcutta)

**Full SDLC control plane** — do not drop stages for slide brevity. Multi-customer ER + finance + priority fairness feed Lead; Grok Bots + Cursor Coding/Testing/Review; ATLAS/OWASP; Grok API intel; token efficiency; NHI exclusive keys; human gates; readiness closes the circle back to Lead.

Child slices under each of the five bots are documented in [`sub-agents.md`](./sub-agents.md). They are not extra roster bots.

**Slide 2** uses a 4-wire room map in [`spacexai-demo-slides.md`](./spacexai-demo-slides.md). **This file keeps the full workflow.** Live surface: `/control`.

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

## Narrative (match `/control` stages)

1. **Intake** — Customer ER, CostEstimate finance, dual human approvals, fairness priority  
2. **Grok Bots** — Lead + CA + Standards + Security + Builder  
3. **ATLAS / OWASP** — collapsed AI Red Team gate; hard-block review-ready PRs  
4. **Cursor** — Coding ships; Testing ∥ Review never merge; exclusive NHI  
5. **Grok API** — classify / extract / score / summarize + trustCheck  
6. **Human gates** — iteration (`red_team|security`) → feature sign-off → merge → release  
7. **Portfolio · tokens · NHI** — multi-customer agility, slice savings, exclusive keys  

Dashed Zscaler = optional `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` (MOCK without credentials). Never auto-merge.
