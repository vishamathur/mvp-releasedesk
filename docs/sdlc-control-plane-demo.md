# One runnable demo — SDLC control plane

**Showcase tip:** [#30](https://github.com/vishamathur/mvp-releasedesk/pull/30) · `cursor/enterprise-sdlc-showcase-79dc`  
**Architecture Mermaid:** [`architecture-mermaid.md`](./architecture-mermaid.md) · Slide 2 in [`spacexai-demo-slides.md`](./spacexai-demo-slides.md)

## Commands

```bash
npm install
npm run build:core && npm run build:lead && npm run build:specialists
npm run demo:control-plane          # headless 7-stage snapshot
npm run desk                        # http://localhost:3002/control
```

Optional live Grok (one app key, never commit it):

```bash
# set XAI_API_KEY in apps/releasedesk/.env.local
npm run demo:control-plane
```

Cursor cloud agents are launched by the Builder Grok Bot, not by Desk. Do not set `RELEASEDESK_CLOUD_CLIENT=real`.

`npm run create:grok-bots` preserves the five Grok Bot app teammates and does not POST them to api.x.ai. The SDLC specs are in `docs/sdlc/`.

## Stages (full workflow — do not drop)

1. **Multi-customer intake** — Customer ER · CostEstimate finance · dual cost+queue approvals · fairness priority  
2. **Grok Bots** — Lead + Change Analyst + Standards + Security + Builder  
3. **ATLAS / OWASP** — collapsed AI Red Team gate; hard-block review-ready PRs  
4. **Iteration gate** — `red_team | security` before proceed  
5. **Cursor → Grok API** — Coding ships; Testing ∥ Review never merge; classify/extract/score/summarize + trustCheck  
6. **Human merge / release** — feature sign-off + merge + release; readiness **back to Lead**  
7. **Portfolio · token efficiency · NHI** — DEMO_PORTFOLIO slices; exclusive `RELEASEDESK_*` keys  

## Also open

| Route | Why |
| --- | --- |
| `/control` | 7-stage live narrative |
| `/mvp` | Portfolio + gate + intel panel |
| `/agents` | Full bot + cloud agent roster |
| `/desk` | Challenge Trigger + bot nav |

Never auto-merge. MOCK when exclusive keys absent.
