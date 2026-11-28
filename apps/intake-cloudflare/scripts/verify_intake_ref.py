#!/usr/bin/env python3
"""Reference contract for Lead's verify_intake.py (SEC-INTAKE-20261128 F3, F6, F7).

This file is the repo spec. It is not installed on the box and it does not
read /workspace/releasedesk-state or any live secret. The box copy must be
updated separately to match these checks.

Notice fields are argv-only and regex-checked. The envelope body is parsed
before it is written, and it is written only after the signature and the
payload binding succeed, with O_EXCL and mode 0600. A seen-set rejects a
replayed sig until its expiry. On HTTP 429 the caller sleeps for Retry-After,
capped at 60 seconds, and retries once.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path

REQUEST_ID_RE = re.compile(r"REQ-\d{8}-\d{6}\Z")
DIGITS_10 = re.compile(r"\d{10}\Z")
HEX_64 = re.compile(r"[0-9a-f]{64}\Z")
KINDS = {None, "intake-card", "visitor-message"}
PURPOSES = ("notice", "envelope", "lead-to-site", "style")
RETRY_CAP_SEC = 60


class VerifyError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def check_notice(rid: str, ts: str, psha: str, sig: str, kind) -> None:
    if not isinstance(rid, str) or not REQUEST_ID_RE.fullmatch(rid):
        raise VerifyError("bad requestId")
    if not (isinstance(ts, str) and DIGITS_10.fullmatch(ts) and isinstance(psha, str) and HEX_64.fullmatch(psha) and isinstance(sig, str) and HEX_64.fullmatch(sig)):
        raise VerifyError("bad notice fields")
    if kind not in KINDS:
        raise VerifyError("bad kind")


def notice_ts(ts: str) -> int:
    """10 decimal digits only. Floats, scientific notation and millisecond values are rejected."""
    check_notice("REQ-20260101-000000", ts, "a" * 64, "b" * 64, None)
    return int(ts)


def purpose_key(master: bytes, purpose: str) -> bytes:
    if purpose not in PURPOSES:
        raise VerifyError("bad purpose")
    return hmac.new(master, f"releasedesk-intake/{purpose}/v1".encode("utf-8"), hashlib.sha256).digest()


def sign_purpose(master: bytes, purpose: str, message: str) -> str:
    return hmac.new(purpose_key(master, purpose), message.encode("utf-8"), hashlib.sha256).hexdigest()


def clamp_retry_after(value, cap: int = RETRY_CAP_SEC) -> int:
    """Seconds to sleep before the single retry. Never more than `cap` (60)."""
    try:
        if isinstance(value, bool) or value is None:
            raise ValueError
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return 0
    if n < 0:
        return 0
    return min(n, cap)


class SeenSet:
    """sig -> expiry unix time. Expired rows are dropped on each check."""

    def __init__(self, path: str):
        self.path = path

    def _load(self, now: int) -> dict:
        try:
            raw = Path(self.path).read_text(encoding="utf-8")
            data = json.loads(raw) if raw else {}
        except (OSError, json.JSONDecodeError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        return {k: int(v) for k, v in data.items() if isinstance(k, str) and isinstance(v, int) and v > now}

    def _store(self, data: dict) -> None:
        parent = os.path.dirname(self.path)
        if parent:
            os.makedirs(parent, mode=0o700, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, json.dumps(data, sort_keys=True).encode("utf-8"))
        finally:
            os.close(fd)

    def reject_or_record(self, sig: str, now: int, ttl: int = 600) -> bool:
        """Return True when `sig` was already seen and is still inside its window."""
        if not HEX_64.fullmatch(sig or ""):
            raise VerifyError("bad notice fields")
        data = self._load(now)
        if sig in data:
            self._store(data)
            return True
        data[sig] = now + ttl
        self._store(data)
        return False


def verify_envelope(body: bytes, rid: str, ts: str, psha: str, sig: str, kind, master: bytes, now: int | None = None) -> dict:
    """Validate a fetched envelope. Does not write it. `ok` is false when the binding fails."""
    out = {"ok": False, "error": None, "kind": None}
    check_notice(rid, ts, psha, sig, kind)
    now = int(time.time()) if now is None else now
    t = int(ts)
    if abs(now - t) > 600:
        out["error"] = "stale notice"
        return out
    try:
        env = json.loads(body.decode("utf-8"))
        pj = env["payloadJson"]
        sg = env["signature"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
        out["error"] = "bad envelope"
        return out
    if not isinstance(pj, str) or not isinstance(sg, dict):
        out["error"] = "bad envelope"
        return out
    if not DIGITS_10.fullmatch(str(sg.get("ts", ""))):
        out["error"] = "bad envelope ts"
        return out
    digest = hashlib.sha256(pj.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(digest, psha):
        out["error"] = "payload hash mismatch"
        return out
    want = sign_purpose(master, "notice", f"notice.v1.{ts}.{rid}.{psha}")
    if not hmac.compare_digest(want, sig):
        out["error"] = "bad signature"
        return out
    env_want = sign_purpose(master, "envelope", f"envelope.v1.{sg['ts']}.{pj}")
    if not hmac.compare_digest(env_want, str(sg.get("hex", ""))):
        out["error"] = "bad envelope signature"
        return out
    try:
        payload = json.loads(pj)
    except json.JSONDecodeError:
        out["error"] = "bad payloadJson"
        return out
    bound = isinstance(payload, dict) and payload.get("requestId") == rid and (kind is None or payload.get("kind") == kind)
    out["ok"] = bool(bound)
    if out["ok"]:
        out["kind"] = payload.get("kind")
    else:
        out["error"] = "payload binding"
    return out


def save_verified(path: str, body: bytes) -> None:
    """Write the envelope only after verification, mode 0600, exclusive create."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, body)
    finally:
        os.close(fd)
