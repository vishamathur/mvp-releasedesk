# SpaceXAI showcase — change list

## Enterprise problem chosen

**SDLC optimization for multi-customer IT services** (Space 1). Northwind Bank KYC is the worked example / proof app — not the problem framing.

## Built (showcase tip)

| Layer | What |
| --- | --- |
| Grok Bots | Lead · Change Analyst · Standards · Security · Builder — defs + packs + Desk panels |
| Cursor path | Builder → **Coding** (ships) → **Testing** ∥ **Review** (never merge) |
| Grok API | `grok-release-intel.ts` — classify / extract / score / summarize + trustCheck |
| Control plane | Desk `/mvp` portfolio (agility · mandatory Security · token slices) + `/agents` |
| Gates | Iteration `red_team\|security`, ATLAS/OWASP merge hard-block, human merge/release |
| Keys | Exclusive `RELEASEDESK_*` NHI per agent — no shared XAI/GROK/CURSOR fallback |
| Intake | Multi-customer dual-approval backlog (still in Desk; demoted from hero) |

## Preserved

- PR #14 iteration proceed gate (`evaluateIterationProceedGate`, `IterationApprovalGate`)
- Mandatory Security participation + AI Red Team / ATLAS spine
- Human merge/release + feature sign-off checklist

## Room artifacts

- [spacexai-demo-slides.md](./spacexai-demo-slides.md)
- [spacexai-room-runbook.md](./spacexai-room-runbook.md) — commands, clicks, MOCK vs live matrix

## Still open / honest

- The five bots already exist in the Grok Bot app. `npm run create:grok-bots` does not POST them.
- Cursor launch is the Builder bot. Desk does not set a live cloud client.
- Without `XAI_API_KEY`, the shipped Grok call is **MOCK**-labeled.
