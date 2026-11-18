# Release Desk — Architecture (Mermaid)

Last updated: 2026-11-17 (Asia/Calcutta)

Two lanes: **SDLC** builds and verifies **KYC**. Queue item approval and cost-record approval are both required before Lead. **Security is mandatory on every change.**

```mermaid
flowchart LR
  subgraph SDLC["SDLC · Release Desk"]
    Req["Customer request"]
    Cost["Cost / billing estimate"]
    Queue["Prioritized backlog"]
    CostApprove["Human cost approval"]
    QApprove["Human queue approval"]
    RePri["Re-prioritize + sign-off"]
    Lead["Lead Agent"]
    Spec["Specialists"]
    Sec["Security · mandatory"]
    Cloud["Cloud Agents"]
    Verify["Checkpoints + remediate"]
    Human["Checklist · merge · release"]
  end

  subgraph APP["App · Northwind KYC"]
    KYC["KYC UI + API + domain"]
  end

  Req --> Cost
  Req --> Queue
  Cost --> CostApprove
  Queue --> QApprove
  CostApprove --> RePri
  QApprove --> RePri
  RePri --> Lead
  Lead --> Spec --> Sec --> Cloud --> Verify --> Human
  Spec -.->|analyze| KYC
  Sec -.->|guardrails on| KYC
  Cloud ==>|build + verify| KYC
  Human -.->|gate release of| KYC
  Human -->|result| Lead
```
