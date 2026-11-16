# Release Desk — Architecture (Mermaid)

Last updated: 2026-11-17 (Asia/Calcutta)

**Cursor-maximized target:** ephemeral **Cloud Agents** run Lead, specialists, Coding / Testing / Review, and AI Red Teaming; **Cursor Apps** host Desk + KYC. Distinct **Testing** vs **Verification** before checkpoints. Summary: [`cursor-maximized-architecture.md`](./cursor-maximized-architecture.md).

```mermaid
flowchart TB
  subgraph TRIG["Cursor triggers · minimize always-on infra"]
    DeskUI["Cursor App · Release Desk UI<br/>intake · approvals · on-demand check"]
    Auto["Automations · scheduled / PR / CI / webhook"]
    Bugbot["Bugbot · PR review assist"]
    Bg["Background / Cloud Agents API"]
  end

  subgraph SDLC["Lane A · SDLC · ephemeral Cloud Agents"]
    Cust["Customers · unique customerId"]
    Req["Customer requests"]
    Cost["Cost estimate · keyed by customerId"]
    Queue["Weighted multi-customer backlog"]
    Views["Per-customer views"]
    CostApprove["Human cost approval · Desk App"]
    QApprove["Human queue approval · Desk App"]
    RePri["Re-prioritize + sign-off · Desk App"]

    Lead["Lead · Cloud Agent"]
    CA["Change Analyst · Cloud Agent"]
    ST["Standards · Cloud Agent"]
    SE["Security · Cloud Agent · mandatory"]
    BU["Builder · Cloud Agent"]
    AIRed["AI Red Teaming · Cloud Agent · ephemeral"]
    Zscal["Zscaler provider · optional MOCK stub"]
    Atlas["ATLAS / OWASP LLM Top 10<br/>hard block · review-ready PRs only"]
    Code["Coding · Cloud Agent"]
    Test["Testing · Cloud Agent"]
    Rev["Review · Cloud Agent"]
    Ver["Verification · independent · Lead"]
    Check["Checkpoints + remediate"]
    FeatSO["Developer sign-off checklist · Desk App"]
    Merge["Human merge approval · Desk + GitHub"]
    Rel["Human release approval · Desk App"]
  end

  subgraph APP["Lane B · Cursor App · Northwind KYC"]
    KYC["KYC UI + API + domain<br/>Cursor Apps hosting · optional Postgres"]
  end

  DeskUI --> Cust
  Auto -.->|Desk → Lead on-demand| Lead
  Bg -.-> Lead
  Bugbot -.->|PR comments| Rev

  Cust --> Req
  Req --> Cost
  Req --> Queue
  Queue --> Views
  Cost --> CostApprove
  Queue --> QApprove
  CostApprove --> RePri
  QApprove --> RePri
  RePri --> Lead
  Lead --> CA --> ST --> SE --> BU --> AIRed --> Atlas
  AIRed -.-> Zscal
  Atlas --> Code --> Test --> Ver --> Check --> FeatSO --> Merge --> Rel
  Code -.-> Rev
  Test -.-> Rev
  Rev -.-> Ver
  CA -.->|AI output| AIRed
  ST -.->|AI output| AIRed
  SE -.->|AI output| AIRed
  BU -.->|AI output| AIRed
  Code -.->|prompts| AIRed
  Test -.->|prompts| AIRed
  Rev -.->|prompts| AIRed
  AIRed -.->|realtime flags| Lead
  CA -.->|analyze| KYC
  SE -.->|guardrails on| KYC
  AIRed -.->|AI/ML red team on| KYC
  Code ==>|implements| KYC
  Test -.->|runs tests on| KYC
  Ver -.->|validates quality of| KYC
  Rel -.->|gate release of| KYC
  Rel -->|result| Lead
```

## How to read this

| Box | Cursor capability |
| --- | --- |
| Desk UI / KYC | **Cursor Apps** (publish-app hosting) |
| Lead, CA, Standards, Security, Builder, AI Red Teaming, Coding, Testing, Review | **Cloud Agents** / Cloud Agents API (ephemeral) |
| Automations | Event/schedule triggers for Desk→Lead and PR/CI follow-ups |
| Bugbot | Complementary PR review on GitHub |
| Background agents | Same Cloud Agents product surface (API / dashboard / mobile) |
| Zscaler | Optional **provider stub** behind `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` (MOCK without credentials); live Zscaler stays an **external** API if ever wired |

Dashed `Zscal` = optional stub. See [`zscaler-ai-red-teaming-provider.md`](./zscaler-ai-red-teaming-provider.md).
