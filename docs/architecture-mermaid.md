# Release Desk — Architecture (Mermaid)

Last updated: 2026-11-17 (Asia/Calcutta)

Multi-customer intake with dual approvals; four specialists; mandatory Security with ATLAS/OWASP hard blockers on review-ready (non-draft) PRs; optional Zscaler AI Red Teaming provider; human checklist + merge/release; feedback to Lead.

```mermaid
flowchart LR
  subgraph SDLC["SDLC · Release Desk"]
    Cust["Customers · unique customerId"]
    Req["Customer requests"]
    Cost["Cost estimate · keyed by customerId"]
    Queue["Weighted multi-customer backlog"]
    Views["Per-customer views"]
    CostApprove["Human cost approval"]
    QApprove["Human queue approval"]
    RePri["Re-prioritize + sign-off"]
    Lead["Lead Agent"]
    CA["Change Analyst"]
    ST["Standards"]
    SE["Security"]
    BU["Builder"]
    AIRed["AI Red Teaming · all AI/prompt touchpoints"]
    Zscal["Zscaler provider · optional MOCK"]
    Gate["Collapsed AI Red Team gate<br/>pre+post in one pass"]
    SideQ["Remediation side-queue · non-blocking"]
    Atlas["ATLAS / OWASP LLM Top 10<br/>hard block · review-ready PRs only"]
    Cloud["Cloud Agents"]
    Verify["Checkpoints + remediate"]
    FeatSO["Developer sign-off checklist"]
    Merge["Human merge approval"]
    Rel["Human release approval"]
  end

  subgraph APP["App · Northwind KYC"]
    KYC["KYC UI + API + domain"]
  end

  Cust --> Req
  Req --> Cost
  Req --> Queue
  Queue --> Views
  Cost --> CostApprove
  Queue --> QApprove
  CostApprove --> RePri
  QApprove --> RePri
  RePri --> Lead
  Lead --> CA --> ST --> SE --> BU --> AIRed --> Gate
  AIRed -.-> Zscal
  Gate -.->|Zscaler/MCP context| Zscal
  Gate -->|red_team OR security approval| Atlas
  Gate -.-> SideQ
  SideQ -.->|async remediate| Cloud
  Atlas --> Cloud --> Verify --> FeatSO --> Merge --> Rel
  CA -.->|AI output| AIRed
  ST -.->|AI output| AIRed
  SE -.->|AI output| AIRed
  BU -.->|AI output| AIRed
  Cloud -.->|Coding/Testing/Review prompts| AIRed
  AIRed -.->|realtime flags| Lead
  CA -.->|analyze| KYC
  SE -.->|guardrails on| KYC
  AIRed -.->|AI/ML red team on| KYC
  Cloud ==>|build + verify| KYC
  Rel -.->|gate release of| KYC
  Rel -->|result| Lead
```

Dashed `Zscal` = optional `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` stub (MOCK without credentials). Collapsed gate runs pre-release + post-remediation in one pass; remediation is a non-blocking side-queue; every iteration needs **red_team or security** approval. See [`zscaler-ai-red-teaming-provider.md`](./zscaler-ai-red-teaming-provider.md).
