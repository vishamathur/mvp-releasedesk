# Release Desk — Grok Bot pack (SpaceXAI challenge)

**Enterprise problem (Space 1):** Northwind Bank delivery managers cannot tell if a KYC release is safe to ship. Manual chase across git, policy, and security burns days; late blockers cost release windows.

**System:** Lead Grok Bot + three specialists. Builder hands work to a **Cursor cloud agent** guided by repo rules/skills. What the agent ships calls the **Grok API** to classify / extract / score / summarize release evidence.

> Paste each `bots/*/PERSONA.md` (+ skills/routines) into [Grok Bot](https://x.ai/bot). Connectors listed per bot. Live Desk demo also mirrors handoffs at `POST /api/bots/trigger`.

## Roster

| Bot | Job | Hands off to |
| --- | --- | --- |
| **Lead — Release Desk** | Owns the release-check run; delegates; consolidates readiness; requests human gates | Change Analyst, Standards, Security (parallel); Builder when remediation needed |
| **Change Analyst** | Diff + release-notes draft + impact | Lead (findings); feeds Standards |
| **Standards** | Policy/compliance deviations with evidence | Lead |
| **Security** | Release-blocking risks | Lead; may recommend Builder |
| **Builder** (specialist #3 if counting CA/Standards/Security — see note) | Turns blockers into Cursor Cloud Agent work | **Cursor Coding agent** → ships Grok API intel endpoint |

**Note:** Brief requires Lead + ≥3 specialists. Use **Change Analyst, Standards, Security** as the three specialists; **Builder** is the handoff bot that launches Cursor (can be a fourth specialist or a skill on Lead). This pack includes Builder as a fourth named bot for a clear Cursor launch boundary.

## Human approval points

1. Dual intake (cost + queue) — before Lead starts (when intake is enabled)
2. Feature sign-off checklist — AI-written features before merge/release readiness
3. Merge gate — never auto-merge
4. Release gate — ship / hold

## Trust / check output

- Structured Grok API JSON (`classify`, `extract`, `score`, `summarize`) validated by schema in `apps/releasedesk`
- `mocked: true` when no `XAI_API_KEY` — labeled MOCK in UI
- Human gates remain authoritative; Grok scores never auto-approve merge/release

## Live demo trigger

```bash
# Desk running on :3001
curl -s -X POST http://localhost:3001/api/bots/trigger \
  -H 'content-type: application/json' \
  -d '{"goal":"Release readiness for Northwind KYC","repository":"vishamathur/mvp-releasedesk"}'
```

Then open the returned run URL and walk handoffs + Grok API intel panel.
