# Slide 1 — Problem statement and assumptions

**Title:** Northwind KYC release readiness — the problem

**One-liner:** Delivery managers cannot tell if a KYC release is safe to ship; late policy and security blockers burn the release window.

## Who / cost / buyer

| | |
| --- | --- |
| **Who feels it** | Delivery managers chasing git + policy + security by hand |
| **What it costs** | Missed release windows, rework, audit risk on KYC changes |
| **Who buys the fix** | Engineering + risk leaders who need an auditable control plane |

## Assumptions (on slide)

1. **Space 1** — software delivery & release readiness (enterprise KYC app under change).
2. **Humans keep authority** — bots advise; merge and release stay human.
3. **Required stack** — Grok Bot (Lead + specialists) + Cursor cloud agent + Grok API in the shipped path.
4. **Trust** — structured Grok output + schema check; scores never auto-approve; red team **or** security sign-off before iteration proceed.

## Speak (≤45s)

“Northwind Bank ships KYC. DMs can’t see readiness without days of chase. Late Security holds cost the window. We built a Lead Grok Bot plus specialists; Builder launches Cursor; shipped code calls Grok API for classify/extract/score/summarize. Humans still own merge and release. Slide two is the map — then we live in the bots.”
