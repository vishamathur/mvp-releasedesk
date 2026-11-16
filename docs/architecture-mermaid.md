# Release Desk — Architecture (Mermaid)

Last updated: 2026-11-17 (Asia/Calcutta)

**Cursor-maximized + implemented runtime:** ephemeral **Cloud Agents** run Lead, specialists, Coding / Testing / Review, and AI Red Teaming (MOCK by default); **Cursor Apps** host Desk + KYC. Desk triggers Lead **on-demand** after human dual approval — **no** backlog queue poller. Shared durable run context crosses ephemeral VMs. Distinct **Testing** vs **Verification** before checkpoints. Capability map: [`cursor-maximized-architecture.md`](./cursor-maximized-architecture.md).

```mermaid
flowchart TB
  subgraph TRIG["Cursor triggers · minimize always-on infra"]
    DeskUI["Cursor App · Release Desk UI<br/>intake · approvals · on-demand Lead"]
    Auto["Automations · PR / CI / webhook<br/>no backlog queue poller"]
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

    Lead["Lead · Cloud Agent · ephemeral"]
    CA["Change Analyst · Cloud Agent"]
    ST["Standards · Cloud Agent"]
    SE["Security · Cloud Agent · mandatory"]
    BU["Builder · Cloud Agent"]
    AIRed["AI Red Teaming · Cloud Agent"]
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
    Store["Shared durable run context<br/>file / Apps Postgres"]
    NHI["Per-agent named secrets<br/>Cursor Apps / Cloud Agent env<br/>NHI · no external vault"]
  end

  subgraph APP["Lane B · Cursor App · Northwind KYC"]
    KYC["KYC UI + API + domain<br/>Cursor Apps hosting · optional Postgres"]
  end

  DeskUI --> Cust
  DeskUI -->|on-demand dispatch| Lead
  Auto -.->|Desk → Lead on-demand only| Lead
  Bg -.-> Lead
  Bugbot -.->|PR comments| Rev
  NHI -.-> Lead
  NHI -.-> CA
  NHI -.-> ST
  NHI -.-> SE
  NHI -.-> BU
  NHI -.-> AIRed
  NHI -.-> Code
  NHI -.-> Test
  NHI -.-> Rev
  NHI -.-> Zscal

  Cust --> Req
  Req --> Cost
  Req --> Queue
  Queue --> Views
  Cost --> CostApprove
  Queue --> QApprove
  CostApprove --> RePri
  QApprove --> RePri
  RePri -->|human-approved| DeskUI
  Lead --> CA
  Lead --> ST
  Lead --> SE
  Lead --> BU
  Lead --> AIRed
  Lead --> Store
  CA --> Store
  ST --> Store
  SE --> Store
  BU --> Store
  AIRed --> Store
  BU --> Atlas
  AIRed --> Atlas
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
  AIRed -.->|realtime flags via store| Lead
  CA -.->|analyze| KYC
  SE -.->|guardrails on| KYC
  AIRed -.->|AI/ML red team on| KYC
  Code ==>|implements| KYC
  Test -.->|runs tests on| KYC
  Ver -.->|validates quality of| KYC
  Rel -.->|gate release of| KYC
  Rel -->|result| Lead
  DeskUI -.->|merge/release gates| Merge
  DeskUI -.->|merge/release gates| Rel
```

## How to read this

| Box | Cursor capability |
| --- | --- |
| Desk UI / KYC | **Cursor Apps** (publish-app hosting) — always-on served layer |
| Lead, CA, Standards, Security, Builder, AI Red Teaming, Coding, Testing, Review | **Cloud Agents** / Cloud Agents API (ephemeral; MOCK default) |
| Automations | PR/CI/webhook → Desk→Lead **on-demand** (not a backlog poller) |
| Bugbot | Complementary PR review on GitHub |
| Shared store | Durable run context for ephemeral agents (`FileBackedRunContextStore` / Apps Postgres) |
| NHI named secrets | Distinct `RELEASEDESK_CURSOR_API_KEY_*` in **Cursor Apps / Cloud Agent environment secrets** (Runtime Secrets preferred); no external vault; prefer OIDC when available |
| Zscaler | Optional **provider stub** behind `RELEASEDESK_AI_RED_TEAM_PROVIDER=zscaler` (MOCK without credentials) |

See [`nhi-cursor-secrets.md`](./nhi-cursor-secrets.md) and [`.env.example`](../.env.example) for secret **names** only. Dashed `Zscal` = optional stub. See [`zscaler-ai-red-teaming-provider.md`](./zscaler-ai-red-teaming-provider.md).
