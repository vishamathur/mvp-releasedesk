#!/usr/bin/env python3
"""Verify a public-intake notice from intake.vishalmathur.org by fetch-back. Run by the Intake bot (and, in --file mode, by Lead).

  verify_intake.py <requestId> <ts> <payloadSha256> <sig> [kind]
      Checks the notice HMAC and a 600 s window, fetches the envelope with the bearer fetch key, checks the envelope
      HMAC and the payload SHA-256, and saves the envelope (mode 0600) to the inbox directory.
  verify_intake.py --file <path>
      Re-checks a saved envelope: path inside the inbox, envelope HMAC over signature.ts + "." + payloadJson.

Prints one JSON line and exits 0 for any checked result (read the ok field); exit 2 is a usage error. ok is true only when every check passed. Secrets are read from files on the shared box and are
never printed, never taken from env vars and never passed on the command line.
"""
import sys, json, hmac, hashlib, time, re, os, urllib.request, urllib.parse, urllib.error

SECRETS = os.environ.get("INTAKE_SECRETS_DIR", "/workspace/releasedesk-secrets")
INBOX = os.environ.get("INTAKE_INBOX_DIR", "/workspace/releasedesk-state/intake-inbox")
BASE = os.environ.get("INTAKE_BASE_URL", "https://intake.vishalmathur.org")
HMAC_FILE, FETCH_FILE = "intake-site-lead-hmac-secret", "intake-site-fetch-key"
REQ_ID = re.compile(r"REQ-\d{8}-\d{6}")
HEX64 = re.compile(r"[0-9a-fA-F]{64}")
KINDS = ("intake-card", "visitor-message")
WINDOW_SEC = 600

def read_secret(name):
    with open(os.path.join(SECRETS, name)) as f:
        v = f.read().strip()
    if len(v) < 32:
        raise ValueError(name + " is too short")
    return v.encode()

def base_ok(url):
    # Production host only. A loopback http URL is allowed so the tests can run without the network.
    return url == "https://intake.vishalmathur.org" or re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", url) is not None

def purpose_key(master, purpose):
    return hmac.new(master, f"releasedesk-intake/{purpose}/v1".encode(), hashlib.sha256).digest()

def check_envelope(body, key, out, psha=None):
    env = json.loads(body)
    pj, sg = env["payloadJson"], env["signature"]
    out["payloadJsonChars"] = len(pj)
    exp = hmac.new(purpose_key(key, "envelope"), f'envelope.v1.{sg["ts"]}.{pj}'.encode(), hashlib.sha256).hexdigest()
    out["envelopeSig"] = hmac.compare_digest(exp, str(sg["hex"]).lower())
    if psha is not None:
        out["shaMatch"] = hashlib.sha256(pj.encode()).hexdigest() == psha.lower()
    return out["envelopeSig"] and (psha is None or out["shaMatch"])

def verify_notice(rid, ts, psha, sig, kind):
    out = {"requestId": rid, "kind": kind, "noticeSig": False, "fresh": False, "fetched": None,
           "envelopeSig": False, "shaMatch": False, "ok": False}
    try:
        if not REQ_ID.fullmatch(rid): out["error"] = "bad requestId"; return out
        if not HEX64.fullmatch(psha) or not HEX64.fullmatch(sig): out["error"] = "bad hex"; return out
        if kind is not None and kind not in KINDS: out["error"] = "bad kind"; return out
        if not re.fullmatch(r"\d{1,13}", ts): out["error"] = "bad ts"; return out
        if not base_ok(BASE): out["error"] = "bad base url"; return out
        key = read_secret(HMAC_FILE)
        exp = hmac.new(purpose_key(key, "notice"), f"notice.v1.{ts}.{rid}.{psha}".encode(), hashlib.sha256).hexdigest()
        out["noticeSig"] = hmac.compare_digest(exp, sig.lower())
        t = int(ts); t = t / 1000 if t > 1e12 else t
        out["fresh"] = abs(time.time() - t) <= WINDOW_SEC
        if not (out["noticeSig"] and out["fresh"]): return out
        q = {"requestId": rid, "payloadSha256": psha}
        if kind: q["kind"] = kind
        req = urllib.request.Request(BASE + "/api/envelope.php?" + urllib.parse.urlencode(q),
                                     headers={"Authorization": "Bearer " + read_secret(FETCH_FILE).decode(), "User-Agent": "release-desk-intake"})
        try:
            body = urllib.request.urlopen(req, timeout=20).read(); out["fetched"] = 200
        except urllib.error.HTTPError as e:
            out["fetched"] = e.code; return out
        os.makedirs(INBOX, exist_ok=True)
        path = os.path.join(INBOX, f"{rid}-{int(time.time())}.json")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f: f.write(body)
        out["savedTo"] = path; out["bodyBytes"] = len(body)
        out["ok"] = check_envelope(body, key, out, psha)
    except Exception as e:
        out["error"] = type(e).__name__ + ": " + str(e)[:200]
    return out

def verify_file(path):
    out = {"file": path, "envelopeSig": False, "ok": False}
    try:
        real = os.path.realpath(path)
        if os.path.dirname(real) != os.path.realpath(INBOX) or not re.fullmatch(r"REQ-\d{8}-\d{6}-\d+\.json", os.path.basename(real)):
            out["error"] = "path is not an inbox file"; return out
        with open(real, "rb") as f: body = f.read()
        out["ok"] = check_envelope(body, read_secret(HMAC_FILE), out)
    except Exception as e:
        out["error"] = type(e).__name__ + ": " + str(e)[:200]
    return out

def main(argv):
    if len(argv) == 3 and argv[1] == "--file": res = verify_file(argv[2])
    elif len(argv) in (5, 6): res = verify_notice(*argv[1:5], argv[5] if len(argv) == 6 else None)
    else:
        print(json.dumps({"ok": False, "error": "usage"})); return 2
    print(json.dumps(res)); return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
