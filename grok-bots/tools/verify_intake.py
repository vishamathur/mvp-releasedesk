#!/usr/bin/env python3
"""Verify a public-intake notice by fetch-back. Same checks as apps/intake-cloudflare/scripts/verify_intake_ref.py.

  verify_intake.py <requestId> <ts> <payloadSha256> <sig> [kind]
      Regex-checks the notice, verifies the purpose-key HMAC, fetches the envelope, checks the
      envelope HMAC, payload hash, and requestId/kind binding, then saves the body (mode 0600).
      A repeated sig inside the seen-set window is rejected. HTTP 429 sleeps for Retry-After
      (at most 60 s) and retries once.
  verify_intake.py --file <path>
      Re-checks a saved inbox envelope: 10-digit signature.ts and envelope.v1 purpose-key HMAC.

Prints one JSON line and exits 0 for any checked result (read the ok field); exit 2 is a usage error.
The HMAC value and the fetch key are read from files. They are never printed and never passed on the command line.
INTAKE_SECRETS_DIR, INTAKE_INBOX_DIR and INTAKE_BASE_URL only name directories and the site origin.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "intake-cloudflare" / "scripts"))
import verify_intake_ref as ref  # noqa: E402

SECRETS = os.environ.get("INTAKE_SECRETS_DIR", "/workspace/releasedesk-secrets")
INBOX = os.environ.get("INTAKE_INBOX_DIR", "/workspace/releasedesk-state/intake-inbox")
BASE = os.environ.get("INTAKE_BASE_URL", "https://intake.vishalmathur.org")
HMAC_FILE, FETCH_FILE = "intake-site-lead-hmac-secret", "intake-site-fetch-key"
WINDOW_SEC = 600


def read_key(name: str) -> bytes:
    with open(os.path.join(SECRETS, name)) as handle:
        value = handle.read().strip()
    if len(value) < 32:
        raise ValueError(name + " is too short")
    return value.encode()


def base_ok(url: str) -> bool:
    return url == "https://intake.vishalmathur.org" or re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", url) is not None


def fetch_envelope(url: str, fetch_key: bytes):
    """Returns (body or None, status, retry_after header or None). Retries once on 429."""
    def once():
        request = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + fetch_key.decode(),
            "User-Agent": "release-desk-intake",
        })
        try:
            return urllib.request.urlopen(request, timeout=20).read(), 200, None
        except urllib.error.HTTPError as error:
            retry = error.headers.get("Retry-After") if error.headers else None
            return None, error.code, retry
    body, code, retry = once()
    if code == 429:
        time.sleep(ref.clamp_retry_after(retry))
        body, code, _retry = once()
    return body, code


def envelope_fields(body: bytes, key: bytes, rid: str, psha: str, kind):
    out = {"envelopeSig": False, "shaMatch": False, "bound": False, "error": None}
    try:
        env = json.loads(body)
        pj, sg = env["payloadJson"], env["signature"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
        out["error"] = "bad envelope"
        return out
    if not isinstance(pj, str) or not isinstance(sg, dict) or not re.fullmatch(r"\d{10}", str(sg.get("ts", ""))):
        out["error"] = "bad envelope ts"
        return out
    digest = hashlib.sha256(pj.encode()).hexdigest()
    out["shaMatch"] = hmac.compare_digest(digest, psha.lower())
    exp = ref.sign_purpose(key, "envelope", f'envelope.v1.{sg["ts"]}.{pj}')
    out["envelopeSig"] = hmac.compare_digest(exp, str(sg.get("hex", "")).lower())
    try:
        payload = json.loads(pj)
    except json.JSONDecodeError:
        out["error"] = "bad payloadJson"
        return out
    out["bound"] = isinstance(payload, dict) and payload.get("requestId") == rid and (kind is None or payload.get("kind") == kind)
    if not out["bound"]:
        out["error"] = "payload binding"
    return out


def verify_notice(rid, ts, psha, sig, kind):
    out = {"requestId": rid, "kind": kind, "noticeSig": False, "fresh": False, "fetched": None,
           "envelopeSig": False, "shaMatch": False, "ok": False}
    try:
        ref.check_notice(rid, ts, psha, sig, kind)
    except ref.VerifyError as error:
        out["error"] = error.code
        return out
    if not base_ok(BASE):
        out["error"] = "bad base url"
        return out
    try:
        key = read_key(HMAC_FILE)
        exp = ref.sign_purpose(key, "notice", f"notice.v1.{ts}.{rid}.{psha}")
        out["noticeSig"] = hmac.compare_digest(exp, sig.lower())
        out["fresh"] = abs(time.time() - int(ts)) <= WINDOW_SEC
        if not (out["noticeSig"] and out["fresh"]):
            return out
        query = {"requestId": rid, "payloadSha256": psha}
        if kind:
            query["kind"] = kind
        url = BASE + "/api/envelope.php?" + urllib.parse.urlencode(query)
        body, code = fetch_envelope(url, read_key(FETCH_FILE))
        out["fetched"] = code
        if body is None:
            return out
        fields = envelope_fields(body, key, rid, psha, kind)
        out["envelopeSig"] = fields["envelopeSig"]
        out["shaMatch"] = fields["shaMatch"]
        if fields["error"] and not (fields["envelopeSig"] and fields["shaMatch"] and fields["bound"]):
            out["error"] = fields["error"]
        out["ok"] = bool(out["noticeSig"] and out["fresh"] and fields["envelopeSig"] and fields["shaMatch"] and fields["bound"])
        if not out["ok"]:
            return out
        os.makedirs(INBOX, exist_ok=True)
        seen = ref.SeenSet(os.path.join(INBOX, ".seen"))
        if seen.reject_or_record(sig.lower(), int(time.time())):
            out["ok"] = False
            out["error"] = "duplicate"
            return out
        path = os.path.join(INBOX, f"{rid}-{int(time.time())}.json")
        ref.save_verified(path, body)
        out["savedTo"] = path
        out["bodyBytes"] = len(body)
    except Exception as error:
        out["error"] = type(error).__name__ + ": " + str(error)[:200]
        out["ok"] = False
    return out


def verify_file(path):
    out = {"file": path, "envelopeSig": False, "ok": False}
    try:
        real = os.path.realpath(path)
        if os.path.dirname(real) != os.path.realpath(INBOX) or not re.fullmatch(r"REQ-\d{8}-\d{6}-\d+\.json", os.path.basename(real)):
            out["error"] = "path is not an inbox file"
            return out
        with open(real, "rb") as handle:
            body = handle.read()
        env = json.loads(body)
        pj, sg = env["payloadJson"], env["signature"]
        ts = str(sg.get("ts", ""))
        if not re.fullmatch(r"\d{10}", ts):
            out["error"] = "bad envelope ts"
            return out
        exp = ref.sign_purpose(read_key(HMAC_FILE), "envelope", f"envelope.v1.{ts}.{pj}")
        out["envelopeSig"] = hmac.compare_digest(exp, str(sg.get("hex", "")).lower())
        out["ok"] = out["envelopeSig"]
    except Exception as error:
        out["error"] = type(error).__name__ + ": " + str(error)[:200]
    return out


def main(argv):
    if len(argv) == 3 and argv[1] == "--file":
        result = verify_file(argv[2])
    elif len(argv) in (5, 6):
        result = verify_notice(*argv[1:5], argv[5] if len(argv) == 6 else None)
    else:
        print(json.dumps({"ok": False, "error": "usage"}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
