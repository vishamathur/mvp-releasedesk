#!/usr/bin/env python3
"""Pre-cutover end-to-end check of the Intake leg. The site keeps sending to Lead the whole time and is not repointed.

What it does, in order (each step prints PASS or FAIL as one JSON line at the end; secrets are read from files on the
shared box and are never printed, never put in env vars or on the command line):
  1. preflight   secret files exist and are long enough; the Intake webhook file has an https url and a key.
  2. submit      POST one real PROBE card to the live site, api/intake.php. The site stores the envelope in D1 and sends
                 its usual notice to Lead. Lead logs a probe and does not open a request (see skill public-intake-relay).
  3. envelope    GET api/envelope.php with the bearer fetch key; compute payloadSha256 of payloadJson.
  4. notice      Build the notice exactly as the site does: {source, kind, requestId, ts, payloadSha256, sig} with
                 sig = HMAC(k_notice, "notice.v1." + ts + "." + requestId + "." + payloadSha256).
  5. webhook     POST the notice to Intake's webhook (url and key from the webhook file).
  6. inbox       Wait for Intake to save the verified envelope in the inbox directory, then re-check its HMAC with
                 verify_intake.py --file. This proves Intake used the same secret as the site.
The hand-off from Intake to Lead is then confirmed in Release Desk Log or Lead's chat (the line "PROBE intake-request
received from intake" for the printed requestId). This script cannot read those chats.

Usage:  intake-inline-e2e.py [--dry-run] [--request-id REQ-...] [--webhook-file PATH] [--wait SECONDS]
  --dry-run       steps 1 only, plus a check that the site answers; nothing is submitted or posted.
  --request-id    skip step 2 and re-send the notice for an existing probe card (envelopes live 24 h).
Exit code 0 only when every step passed.
"""
import sys, os, re, json, time, hmac, hashlib, argparse, subprocess, urllib.request, urllib.parse, urllib.error

SECRETS = os.environ.get("INTAKE_SECRETS_DIR", "/workspace/releasedesk-secrets")
INBOX = os.environ.get("INTAKE_INBOX_DIR", "/workspace/releasedesk-state/intake-inbox")
BASE = os.environ.get("INTAKE_BASE_URL", "https://intake.vishalmathur.org")
VERIFIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grok-bots", "tools", "verify_intake.py")
DEFAULT_WEBHOOK_FILE = os.path.join(SECRETS, "intake-bot-public-intake-webhook.json")
PROBE_PREFIX = "PROBE-E2E"

def secret(name):
    with open(os.path.join(SECRETS, name)) as f: v = f.read().strip()
    if len(v) < 32: raise ValueError(name + " is too short")
    return v

def base_ok(u): return u == "https://intake.vishalmathur.org" or re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", u) is not None

def http(method, url, headers=None, body=None, timeout=20):
    # Cloudflare's bot rules answer 403 to the default Python-urllib User-Agent, so name this client.
    req = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": "release-desk-intake-e2e/1.0", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()

def probe_card():
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    return {"route": "er", "pid": "PID-ER", "catalogueOptionId": "ER-KYC-LABELS", "addOns": [],
            "contactName": "Release Desk Probe", "email": "probe@example.invalid", "company": "Release Desk Probe",
            "customerId": "cust_probe", "projectRef": "PRJ-PROBE", "changeType": "enhancement",
            "title": f"{PROBE_PREFIX} Intake leg check {stamp}",
            "description": "Automated pre-cutover probe of the Intake leg. Log only. Do not open a request.",
            "urgency": "standard", "artifactLinks": [], "website": "", "consent": True,
            "hasRepo": True, "repoHost": "github", "repo": "octocat/Hello-World",
            "repoDefaultBranch": "master", "repoStack": "Public sample repository used for the Intake probe",
            "repoContact": "Release Desk Probe"}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--request-id")
    ap.add_argument("--webhook-file", default=DEFAULT_WEBHOOK_FILE); ap.add_argument("--wait", type=int, default=180)
    a = ap.parse_args()
    steps = []
    def step(name, ok, **kw):
        steps.append({"step": name, "pass": bool(ok), **kw}); return ok
    def done():
        allok = all(s["pass"] for s in steps)
        print(json.dumps({"result": "PASS" if allok else "FAIL", "steps": steps})); sys.exit(0 if allok else 1)
    try:
        # 1 preflight
        hmac_key, fetch_key = secret("intake-site-lead-hmac-secret"), secret("intake-site-fetch-key")
        with open(a.webhook_file) as f: wh = json.load(f)
        url, wkey, auth = str(wh.get("url", "")), str(wh.get("key", "")), str(wh.get("auth", "bearer"))
        pre = base_ok(BASE) and (url.startswith("https://") or re.match(r"http://127\.0\.0\.1:\d+", url) is not None) and len(wkey) >= 8 \
              and (auth == "bearer" or re.fullmatch(r"header:[A-Za-z0-9-]{1,64}", auth) is not None)
        if not step("preflight", pre, webhookAuth=("bearer" if auth == "bearer" else "header"), webhookKeyChars=len(wkey)): done()
        if a.dry_run:
            code, _ = http("GET", BASE + "/api/catalogue.php"); step("site-reachable", code == 200, http=code); done()
        # 2 submit
        rid = a.request_id
        if rid is None:
            body = json.dumps(probe_card()).encode()
            code, raw = http("POST", BASE + "/api/intake.php", {"Content-Type": "application/json", "Origin": "https://intake.vishalmathur.org"}, body)
            rid = (json.loads(raw).get("referenceId") if code == 200 else None)
            if not step("submit", rid is not None, http=code, requestId=rid): done()
        elif not step("submit", re.fullmatch(r"REQ-\d{8}-\d{6}", rid) is not None, requestId=rid, reused=True): done()
        # 3 envelope
        q = urllib.parse.urlencode({"requestId": rid, "kind": "intake-card"})
        code, raw = http("GET", BASE + "/api/envelope.php?" + q, {"Authorization": "Bearer " + fetch_key, "User-Agent": "release-desk-intake"})
        if not step("envelope", code == 200, http=code): done()
        env = json.loads(raw); pj = env["payloadJson"]
        card = json.loads(pj)
        is_probe = str(card.get("ask", {}).get("title", "")).startswith(PROBE_PREFIX)
        if not step("card-is-probe", is_probe): done()
        psha = hashlib.sha256(pj.encode()).hexdigest()
        # 4 notice
        ts = str(int(time.time()))
        k_notice = hmac.new(hmac_key.encode(), b"releasedesk-intake/notice/v1", hashlib.sha256).digest()
        sig = hmac.new(k_notice, f"notice.v1.{ts}.{rid}.{psha}".encode(), hashlib.sha256).hexdigest()
        notice = {"source": env["source"], "kind": env["kind"], "requestId": rid, "ts": ts, "payloadSha256": psha, "sig": sig}
        step("notice", len(json.dumps(notice)) < 2048, bytes=len(json.dumps(notice)))
        # 5 webhook
        before = set(os.listdir(INBOX)) if os.path.isdir(INBOX) else set()
        hdr = {"Content-Type": "application/json"}
        if auth == "bearer": hdr["Authorization"] = "Bearer " + wkey
        else: hdr[auth[7:]] = wkey
        code, _ = http("POST", url, hdr, json.dumps(notice).encode(), 15)
        if not step("webhook", 200 <= code < 300, http=code): done()
        # 6 inbox
        deadline, found = time.time() + a.wait, None
        while time.time() < deadline and found is None:
            for n in sorted(set(os.listdir(INBOX)) - before) if os.path.isdir(INBOX) else []:
                if n.startswith(rid + "-") and n.endswith(".json"): found = os.path.join(INBOX, n); break
            if found is None: time.sleep(3)
        if not step("inbox-file", found is not None, waitedSec=int(a.wait - max(0, deadline - time.time()))): done()
        p = subprocess.run([sys.executable, VERIFIER, "--file", found], capture_output=True, text=True, timeout=30)
        res = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {}
        step("inbox-envelope-hmac", res.get("ok") is True, requestId=rid, file=os.path.basename(found))
    except Exception as e:
        step("error", False, error=type(e).__name__ + ": " + str(e)[:200])
    done()

if __name__ == "__main__":
    main()
