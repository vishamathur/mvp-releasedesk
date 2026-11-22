#!/usr/bin/env python3
"""Release Desk bot-to-bot handover sequence diagram (SVG -> PNG via rsvg-convert)."""
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[1] / "docs" / "sdlc"
SVG = OUT / "release-desk-handover-diagram.svg"
PNG = OUT / "release-desk-handover-diagram.png"

BG, PAPER, INK, MUTED, LINE = "#F3F5F8", "#FFFFFF", "#0F172A", "#475569", "#CBD5E1"
LANES = [
    ("vishal", "Vishal", "human approver", "#92400E", "#FEF3C7"),
    ("intake", "Intake", "public front door · talks to Lead", "#0369A1", "#E0F2FE"),
    ("lead", "Release Desk Lead", "orchestrator · sole pid.state writer", "#1D4ED8", "#DBEAFE"),
    ("ca", "Change Analyst", "estimation · finance & proposal gates", "#0F766E", "#CCFBF1"),
    ("std", "Standards", "compliance consultant", "#6D28D9", "#EDE9FE"),
    ("sec", "Security", "security-compliance gate", "#BE123C", "#FFE4E6"),
    ("bld", "Builder", "build · release gate", "#C2410C", "#FFEDD5"),
    ("cur", "Cursor cloud agent", "launched by Builder", "#334155", "#E2E8F0"),
    ("gh", "GitHub repo", "vishamathur/mvp-releasedesk", "#111827", "#E5E7EB"),
    ("log", "Release Desk Log", "append-only audit · cc only", "#475569", "#F1F5F9"),
]
KIND = {  # color, dash, width
    "stage-handoff": ("#1D4ED8", None, 3),
    "stage-return": ("#0F172A", None, 3),
    "build-result": ("#C2410C", None, 4),
    "consult": ("#64748B", "7,5", 2),
    "gate-ask": ("#D97706", None, 4),
    "gate-decision": ("#B45309", "10,5", 4),
    "tool": ("#334155", "3,4", 2.5),
    "chat": ("#92400E", None, 2.5),
    "intake-request": ("#0369A1", None, 3),
    "public-status": ("#0369A1", "6,4", 2.5),
}
W = 2400
LEFT = 40
LANE_W = (W - LEFT - 60) / len(LANES)
X = {k: LEFT + LANE_W * (i + 0.5) for i, (k, *_r) in enumerate(LANES)}
ROW = 44

# (from, to, label, kind) ; ("note", lane, text) ; ("sep", text)
ER = [
    ("intake", "lead", "0 · intake-request · public PID-ER card", "intake-request"),
    ("vishal", "lead", "1 · chat · start PID-ER (customer, product, ask)", "chat"),
    ("note", "lead", "writes pid.state · stage intake"),
    ("lead", "ca", "2 · consult · intake", "consult"),
    ("ca", "lead", "3 · consult (return) · intake", "consult"),
    ("lead", "ca", "4 · stage-handoff · estimation", "stage-handoff"),
    ("ca", "std", "5 · consult · estimation", "consult"),
    ("std", "ca", "6 · consult (return)", "consult"),
    ("ca", "lead", "7 · stage-return · estimation", "stage-return"),
    ("note", "lead", "pid.state → finance-approval · ready-for-human"),
    ("lead", "ca", "8 · stage-handoff · finance-approval", "stage-handoff"),
    ("ca", "vishal", "9 · HUMAN GATE ask · finance-approval (Finance partner)", "gate-ask"),
    ("vishal", "ca", "10 · decision · APPROVE (verbatim, timestamped)", "gate-decision"),
    ("ca", "lead", "11 · stage-return · finance-approval (humanGate approved)", "stage-return"),
    ("note", "lead", "pid.state → security-compliance-approval"),
    ("lead", "sec", "12 · stage-handoff · security-compliance-approval", "stage-handoff"),
    ("sec", "std", "13 · consult · compliance deviations", "consult"),
    ("std", "sec", "14 · consult (return)", "consult"),
    ("sec", "ca", "15 · consult · impact", "consult"),
    ("ca", "sec", "16 · consult (return)", "consult"),
    ("sec", "vishal", "17 · HUMAN GATE ask · security-compliance (security | red_team)", "gate-ask"),
    ("vishal", "sec", "18 · decision · APPROVE as security = iteration gate", "gate-decision"),
    ("sec", "lead", "19 · stage-return · security-compliance-approval (approved)", "stage-return"),
    ("note", "lead", "pid.state → build"),
    ("lead", "bld", "20 · stage-handoff · build (start | remediate)", "stage-handoff"),
    ("bld", "cur", "21 · CloudAgent launch", "tool"),
    ("cur", "gh", "22 · branch + PR (code calls Grok API)", "tool"),
    ("gh", "bld", "23 · PR + CI checks (GitHub read)", "tool"),
    ("bld", "sec", "24 · consult · build (PR diff)", "consult"),
    ("sec", "bld", "25 · consult (return)", "consult"),
    ("bld", "std", "26 · consult · build (policy)", "consult"),
    ("std", "bld", "27 · consult (return)", "consult"),
    ("bld", "lead", "28 · build-result · build (branch, prUrl, testsPassed)", "build-result"),
    ("note", "lead", "pid.state → test-gate (no human gate)"),
    ("lead", "bld", "29 · consult · test-gate", "consult"),
    ("bld", "lead", "30 · consult (return)", "consult"),
    ("lead", "sec", "31 · consult · test-gate (open blockers?)", "consult"),
    ("sec", "lead", "32 · consult (return)", "consult"),
    ("loop", "lead", "bld", "tests fail or Security blocker → back to 20 as stage-handoff · build · remediate (max 3)"),
    ("note", "lead", "pid.state → release-gate · ready-for-human"),
    ("lead", "bld", "33 · stage-handoff · release-gate", "stage-handoff"),
    ("bld", "sec", "34 · consult · release-gate", "consult"),
    ("sec", "bld", "35 · consult (return)", "consult"),
    ("bld", "std", "36 · consult · release-gate", "consult"),
    ("std", "bld", "37 · consult (return)", "consult"),
    ("bld", "vishal", "38 · HUMAN GATE ask · release-gate go/no-go (Release manager)", "gate-ask"),
    ("vishal", "bld", "39 · decision · GO (verbatim, timestamped)", "gate-decision"),
    ("bld", "lead", "40 · stage-return · release-gate (approved)", "stage-return"),
    ("note", "lead", "pid.state → done"),
    ("lead", "intake", "41 · public-status · done", "public-status"),
    ("lead", "vishal", "41b · chat · status: done, PR ready (info only)", "chat"),
    ("vishal", "gh", "42 · Vishal merges the PR himself (no bot merges)", "chat"),
]
NC = [
    ("intake", "lead", "N0 · intake-request · public PID-NC card", "intake-request"),
    ("vishal", "lead", "N1 · chat · start PID-NC (legal name, jurisdiction, sponsor)", "chat"),
    ("lead", "ca", "N2 · consult · intake, then customer-onboarding (Lead owns)", "consult"),
    ("lead", "ca", "N3 · stage-handoff · discovery", "stage-handoff"),
    ("ca", "std", "N4 · consult · discovery", "consult"),
    ("ca", "sec", "N5 · consult · discovery", "consult"),
    ("ca", "lead", "N6 · stage-return · discovery", "stage-return"),
    ("lead", "ca", "N7 · stage-handoff · scope", "stage-handoff"),
    ("ca", "std", "N8 · consult · scope", "consult"),
    ("ca", "lead", "N9 · stage-return · scope", "stage-return"),
    ("lead", "ca", "N10 · stage-handoff · proposal", "stage-handoff"),
    ("ca", "std", "N11 · consult · proposal", "consult"),
    ("ca", "vishal", "N12 · HUMAN GATE ask · proposal (Customer sponsor)", "gate-ask"),
    ("vishal", "ca", "N13 · decision · APPROVE (verbatim, timestamped)", "gate-decision"),
    ("ca", "lead", "N14 · stage-return · proposal (approved)", "stage-return"),
    ("lead", "ca", "N15 · stage-handoff · estimation (phased cost range)", "stage-handoff"),
    ("ca", "bld", "N16 · consult · effort (Builder, Security, Standards)", "consult"),
    ("note", "lead", "then steps 7–19 as PID-ER (finance memo, security sign-off)"),
    ("note", "lead", "writes pid.kickoff naming a future sprint, then steps 20–42"),
]


def t(x, y, s, size=15, weight=400, fill=INK, anchor="middle", italic=False):
    st = ' font-style="italic"' if italic else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="Inter, DejaVu Sans, sans-serif" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{st}>{escape(s)}</text>')


def label_w(s, size):
    return len(s) * size * 0.56 + 16


def cc_dot(y, tag):
    x = X["log"]
    return (f'<circle cx="{x - 52:.1f}" cy="{y - 6:.1f}" r="6" fill="#475569"/>'
            + t(x - 40, y - 1, "cc · " + tag, 12, 600, "#475569", "start"))


def draw_rows(rows, y0, dashed_panel=False):
    out = []
    y = y0
    for r in rows:
        if r[0] == "note":
            x = X[r[1]]
            s = "✎ " + r[2]
            w = label_w(s, 13)
            out.append(f'<rect x="{x - 10:.1f}" y="{y - 15:.1f}" width="{w:.1f}" height="26" rx="6" fill="#DBEAFE" stroke="#1D4ED8" stroke-width="1.5"/>')
            out.append(t(x - 2, y + 3, s, 13, 600, "#1E3A8A", "start"))
            out.append(cc_dot(y - 2, "transition"))
            y += ROW * 0.85
            continue
        if r[0] == "loop":
            a, b = X[r[1]], X[r[2]]
            out.append(f'<path d="M{b:.1f},{y - 4:.1f} C{b:.1f},{y + 22:.1f} {a:.1f},{y + 22:.1f} {a:.1f},{y - 4:.1f}" fill="none" stroke="#DC2626" stroke-width="2.5" stroke-dasharray="6,4" marker-end="url(#m-red)"/>')
            s = r[3]
            w = label_w(s, 13)
            mid = (a + b) / 2
            out.append(f'<rect x="{mid - w / 2:.1f}" y="{y + 12:.1f}" width="{w:.1f}" height="24" rx="5" fill="#FEF2F2" stroke="#DC2626"/>')
            out.append(t(mid, y + 29, s, 13, 600, "#991B1B"))
            y += ROW * 1.15
            continue
        a, b, s, kind = r
        color, dash, width = KIND[kind]
        if dashed_panel and kind in ("stage-handoff", "stage-return"):
            dash = dash or "12,6"
        x1, x2 = X[a], X[b]
        d = 1 if x2 > x1 else -1
        da = f' stroke-dasharray="{dash}"' if dash else ""
        mk = "m-" + kind
        out.append(f'<line x1="{x1 + d * 6:.1f}" y1="{y:.1f}" x2="{x2 - d * 10:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="{width}"{da} marker-end="url(#{mk})"/>')
        size = 14 if kind != "consult" else 13
        wgt = 700 if kind in ("gate-ask", "gate-decision", "build-result") else 600
        w = label_w(s, size)
        mid = (x1 + x2) / 2
        lx = min(max(mid - w / 2, 8), W - w - 8)
        fill = "#FFFBEB" if kind.startswith("gate") else PAPER
        out.append(f'<rect x="{lx:.1f}" y="{y - 27:.1f}" width="{w:.1f}" height="22" rx="4" fill="{fill}" opacity="0.96"/>')
        out.append(t(lx + w / 2, y - 11, s, size, wgt, color if kind != "consult" else "#334155"))
        if kind not in ("tool",) and not (kind == "chat" and b in ("lead", "gh")):
            tag = {"gate-ask": "gate-ask", "gate-decision": "gate-decision", "chat": "transition"}.get(kind, "sent+recv")
            out.append(cc_dot(y, tag))
        y += ROW
    return out, y


def main():
    parts = []
    fan_top = 150
    head_y = fan_top + 300
    er_out, er_end = draw_rows(ER, head_y + 140)
    nc_top = er_end + 40
    nc_out, nc_end = draw_rows(NC, nc_top + 140, dashed_panel=True)
    legend_top = nc_end + 30
    H = int(legend_top + 280)

    defs = ['<defs>']
    for k, (c, _d, _w) in KIND.items():
        defs.append(f'<marker id="m-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>')
    defs.append('<marker id="m-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#DC2626"/></marker>')
    defs.append('</defs>')

    parts.append(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
    parts.append(t(40, 58, "Release Desk on Grok Bot: every bot-to-bot handover (PID-ER, with PID-NC extras)", 32, 800, INK, "start"))
    parts.append(t(40, 96, "Intake sends intake-request to Lead. Lead is the only writer of pid.state.{requestId} and sends public-status back. Every stage-return and build-result goes to Lead.", 17, 500, MUTED, "start"))
    parts.append(t(40, 122, "Human gates are asked and answered between Vishal and the bot that owns that work. Lead never asks Vishal for an approval and never sets one.", 17, 700, "#92400E", "start"))

    # cc fan-in panel
    parts.append(f'<rect x="20" y="{fan_top}" width="{W - 40}" height="280" rx="14" fill="#F8FAFC" stroke="#475569" stroke-width="2" stroke-dasharray="10,6"/>')
    parts.append(t(40, fan_top + 32, "Audit trail: every bot copies Release Desk Log (SendToAgent, priority false) on each handoff.v1 sent or received, each REJECT, each gate ask and human decision; Lead also sends each stage transition", 17, 700, "#334155", "start"))
    bots = [l for l in LANES if l[0] in ("intake", "lead", "ca", "std", "sec", "bld")]
    bw, gap = 250, 40
    bx0 = 60
    by = fan_top + 60
    logx, logy, logw, logh = 1000, fan_top + 190, 330, 64
    for i, (k, name, sub, c, bg) in enumerate(bots):
        x = bx0 + i * (bw + gap)
        parts.append(f'<rect x="{x}" y="{by}" width="{bw}" height="48" rx="8" fill="{bg}" stroke="{c}" stroke-width="2"/>')
        parts.append(t(x + bw / 2, by + 30, name, 16, 800, c))
        sx, sy = x + bw / 2, by + 48
        parts.append(f'<path d="M{sx},{sy} C{sx},{sy + 60} {logx + logw / 2},{logy - 60} {logx + logw / 2},{logy - 4}" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="7,5" marker-end="url(#m-consult)"/>')
    parts.append(t(logx - 20, logy + 38, "dashed = cc copy (priority false)", 14, 700, "#475569", "end"))
    parts.append(f'<rect x="{logx}" y="{logy}" width="{logw}" height="{logh}" rx="10" fill="#F1F5F9" stroke="#475569" stroke-width="2.5"/>')
    parts.append(t(logx + logw / 2, logy + 27, "Release Desk Log", 18, 800, "#334155"))
    parts.append(t(logx + logw / 2, logy + 49, "never routes · never approves · flags anomalies", 12.5, 500, MUTED))
    fx = logx + logw + 60
    parts.append(f'<line x1="{logx + logw}" y1="{logy + 32}" x2="{fx - 8}" y2="{logy + 32}" stroke="#475569" stroke-width="2.5" marker-end="url(#m-stage-return)"/>')
    parts.append(f'<rect x="{fx}" y="{logy + 8}" width="500" height="48" rx="8" fill="{PAPER}" stroke="#475569" stroke-width="1.5"/>')
    parts.append(t(fx + 250, logy + 38, "/workspace/releasedesk-log/{requestId}.jsonl", 15, 700, INK))
    dx = fx + 560
    parts.append(f'<line x1="{fx + 500}" y1="{logy + 32}" x2="{dx - 8}" y2="{logy + 32}" stroke="#475569" stroke-width="2.5" marker-end="url(#m-stage-return)"/>')
    parts.append(f'<rect x="{dx}" y="{logy + 8}" width="{W - 60 - dx}" height="48" rx="8" fill="#DBEAFE" stroke="#1D4ED8" stroke-width="1.5"/>')
    parts.append(t((dx + W - 60) / 2, logy + 38, "Desk /handoff (read-only)", 15, 700, "#1E3A8A"))

    # ER panel
    parts.append(f'<rect x="20" y="{head_y:.1f}" width="{W - 40}" height="{er_end - head_y + 10:.1f}" rx="14" fill="{PAPER}" stroke="{LINE}" stroke-width="2"/>')
    parts.append(t(40, head_y + 30, "PID-ER · enhancement for an existing customer · Lead chat", 20, 800, "#1E3A8A", "start"))
    # NC panel
    parts.append(f'<rect x="20" y="{nc_top:.1f}" width="{W - 40}" height="{nc_end - nc_top + 10:.1f}" rx="14" fill="#FAF5FF" stroke="#7C3AED" stroke-width="2.5" stroke-dasharray="14,8"/>')
    parts.append(t(40, nc_top + 32, "PID-NC extras · new customer · Lead chat · dashed = stages that exist only in PID-NC (inserted between steps 3 and 4)", 20, 800, "#5B21B6", "start"))

    # lanes (headers in each panel + lifelines)
    for (k, name, sub, c, bg) in LANES:
        x = X[k]
        for top, bottom in ((head_y + 44, er_end), (nc_top + 44, nc_end)):
            parts.append(f'<line x1="{x:.1f}" y1="{top + 50:.1f}" x2="{x:.1f}" y2="{bottom:.1f}" stroke="{c}" stroke-width="1.5" stroke-dasharray="2,5" opacity="0.6"/>')
            bw = LANE_W - 16
            parts.append(f'<rect x="{x - bw / 2:.1f}" y="{top:.1f}" width="{bw:.1f}" height="50" rx="8" fill="{bg}" stroke="{c}" stroke-width="2"/>')
            parts.append(t(x, top + 22, name, 16, 800, c))
            parts.append(t(x, top + 41, sub, 11.5, 500, MUTED))

    parts += er_out + nc_out

    # legend
    ly = legend_top
    parts.append(f'<rect x="20" y="{ly:.1f}" width="{W - 40}" height="250" rx="14" fill="#0F172A"/>')
    parts.append(t(40, ly + 34, "Message kinds (handoff.v1)", 18, 800, "#F8FAFC", "start"))
    items = [
        ("stage-handoff", "stage-handoff · Lead → work owner (start | remediate | block)"),
        ("stage-return", "stage-return · owner → Lead (carries the human decision on gate stages)"),
        ("build-result", "build-result · Builder → Lead (proposedBranch, prUrl, testsPassed, testsSummary)"),
        ("consult", "consult · ask and answer between teammates; never moves a stage"),
        ("gate-ask", "HUMAN GATE ask · owning bot → Vishal in its own chat"),
        ("gate-decision", "decision · Vishal's verbatim reply; decidedBy = human name"),
        ("tool", "tool call · CloudAgent / GitHub (not a teammate message)"),
        ("chat", "chat with Vishal · trigger, status, his own merge"),
        ("consult", "● cc · <tag> on the Log lane = line appended to {requestId}.jsonl"),
        ("intake-request", "intake-request · Intake → Lead (public card, real-only)"),
        ("public-status", "public-status · Lead → Intake (what the visitor may be told)"),
    ]
    for i, (k, s) in enumerate(items):
        col, row = i % 2, i // 2
        x0 = 40 + col * 1180
        y0 = ly + 66 + row * 30
        c, dsh, wd = KIND[k]
        if k in ("stage-return",):
            c = "#E2E8F0"
        da = f' stroke-dasharray="{dsh}"' if dsh else ""
        parts.append(f'<line x1="{x0}" y1="{y0 - 5}" x2="{x0 + 70}" y2="{y0 - 5}" stroke="{c}" stroke-width="{wd}"{da}/>')
        parts.append(t(x0 + 85, y0, s, 15, 500, "#E2E8F0", "start"))

    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + "".join(defs) + "".join(parts) + "</svg>"
    SVG.write_text(svg, encoding="utf-8")
    subprocess.run(["rsvg-convert", "-w", str(W), "-o", str(PNG), str(SVG)], check=True)
    print(PNG, W, H)


if __name__ == "__main__":
    main()
