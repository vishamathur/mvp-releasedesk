# One runnable demo — SDLC control plane

**PR tip:** stack on #28 (`cursor/cursor-cloud-grok-api-ship-d498`).  
**Branch:** `cursor/sdlc-control-plane-2ceb`

## Commands

```bash
npm install
npm run build:core && npm run build:lead && npm run build:specialists
npm run demo:control-plane          # headless snapshot
npm run desk                        # http://localhost:3001/control
```

Optional live Grok:

```bash
export RELEASEDESK_GROK_API_KEY_LEAD=...
export RELEASEDESK_GROK_API_KEY_BUILDER=...
npm run demo:control-plane
```

Optional live Cursor CAs:

```bash
export RELEASEDESK_CURSOR_API_KEY_CODING=...
export RELEASEDESK_CURSOR_API_KEY_TESTING=...
export RELEASEDESK_CURSOR_API_KEY_REVIEW=...
export RELEASEDESK_CLOUD_CLIENT=real
```

Create Grok Bots in-app / API script:

```bash
npm run create:grok-bots -- --dry-run
```

## Stages (enterprise depth)

1. Multi-customer intake (dual approvals)  
2. Grok Bots Lead + Change Analyst + Standards + Security + Builder  
3. ATLAS / OWASP AI Red Team collapsed gate  
4. Iteration gate `red_team | security`  
5. Cursor Coding ships → Grok API classify/extract/score/summarize  
6. Human merge / release (+ feature sign-off)  
7. Portfolio · token efficiency · NHI exclusive keys  

## Slides (live-edit)

- `docs/spacexai-two-slides.md`
- `docs/spacexai-demo-slides.md`

## Showcase desk still available

`http://localhost:3001/desk` — bots panel + Challenge Trigger + runs.
