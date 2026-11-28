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

import fcntl
import hashlib
import hmac
import json
import os
import re
import tempfile
import time
from pathlib import Path

REQUEST_ID_RE = re.compile(r"REQ-\d{8}-\d{6}\Z")
DIGITS_10 = re.compile(r"\d{10}\Z")
HEX_64 = re.compile(r"[0-9a-f]{64}\Z")
KINDS = {"intake-card", "visitor-message"}
PURPOSES = ("notice", "envelope", "lead-to-site", "style", "intake-request")
INTAKE_SENDER_ID = "ce1f6670-8b51-4478-8f61-42911ea3be41"
INTAKE_REQUEST_WINDOW_SEC = 300
INTAKE_REQUEST_KEYS = (
    "v", "kind", "pid", "pidVersion", "requestId", "thread", "from", "to", "stage", "action",
    "summary", "artifactRefs", "memoryKey", "humanGate", "senderId", "nonce", "ts", "sig",
    "contactRef", "untrusted",
)
INTAKE_REQUEST_BODY_KEYS = tuple(key for key in INTAKE_REQUEST_KEYS if key not in ("sig", "nonce", "ts"))
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
    check_notice("REQ-20260101-000000", ts, "a" * 64, "b" * 64, "intake-card")
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
        """A missing file is an empty set. A file that exists but cannot be read or parsed is rejected."""
        path = Path(self.path)
        if not path.exists():
            return {}
        try:
            raw = path.read_text(encoding="utf-8")
            if not raw.strip():
                raise VerifyError("seen set unreadable")
            data = json.loads(raw)
        except VerifyError:
            raise
        except (OSError, json.JSONDecodeError, UnicodeError, ValueError) as error:
            raise VerifyError("seen set unreadable") from error
        if not isinstance(data, dict):
            raise VerifyError("seen set unreadable")
        kept = {}
        for key, value in data.items():
            if not isinstance(key, str) or isinstance(value, bool) or not isinstance(value, int):
                raise VerifyError("seen set unreadable")
            if value > now:
                kept[key] = value
        return kept

    def _store(self, data: dict) -> None:
        """Replace the set by writing a temp file and renaming it. A crash leaves the previous set."""
        parent = os.path.dirname(self.path) or "."
        os.makedirs(parent, mode=0o700, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".seen.", dir=parent)
        try:
            os.write(fd, json.dumps(data, sort_keys=True).encode("utf-8"))
            os.fchmod(fd, 0o600)
        except Exception:
            os.close(fd)
            os.unlink(tmp)
            raise
        os.close(fd)
        os.replace(tmp, self.path)

    def reject_or_record(self, sig: str, now: int, ttl: int = 600) -> bool:
        """Return True when `sig` was already seen and is still inside its window.

        The check and the record share one exclusive lock, so two callers cannot both accept the same sig.
        """
        if not HEX_64.fullmatch(sig or ""):
            raise VerifyError("bad notice fields")
        parent = os.path.dirname(self.path) or "."
        os.makedirs(parent, mode=0o700, exist_ok=True)
        lock_fd = os.open(self.path + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            data = self._load(now)
            if sig in data:
                self._store(data)
                return True
            data[sig] = now + ttl
            self._store(data)
            return False
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)


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
    bound = isinstance(payload, dict) and payload.get("requestId") == rid and payload.get("kind") == kind
    out["ok"] = bool(bound)
    if out["ok"]:
        out["kind"] = payload.get("kind")
    else:
        out["error"] = "payload binding"
    return out


class IntakeRateLimit:
    """Per-sender and per-contactRef windows. In memory, or a locked file when path is set."""

    def __init__(self, path: str | None = None, sender_max: int = 10, contact_max: int = 5, window: int = 600):
        self.path = path
        self.sender_max = sender_max
        self.contact_max = contact_max
        self.window = window
        self._mem: dict[str, list[int]] = {}

    def _fresh(self, data: dict, key: str, now: int) -> list[int]:
        hits = [ts for ts in data.get(key, []) if isinstance(ts, int) and now - ts < self.window]
        data[key] = hits
        return hits

    def allow(self, sender: str, contact: str, now: int) -> str | None:
        if self.path is None:
            return self._decide(self._mem, sender, contact, now)
        parent = os.path.dirname(self.path) or "."
        os.makedirs(parent, mode=0o700, exist_ok=True)
        lock_fd = os.open(self.path + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            data: dict = {}
            path = Path(self.path)
            if path.exists():
                raw = path.read_text(encoding="utf-8")
                parsed = json.loads(raw) if raw.strip() else {}
                if not isinstance(parsed, dict):
                    raise VerifyError("rate limit unreadable")
                data = parsed
            decision = self._decide(data, sender, contact, now)
            fd, tmp = tempfile.mkstemp(prefix=".rate.", dir=parent)
            try:
                os.write(fd, json.dumps(data, sort_keys=True).encode("utf-8"))
                os.fchmod(fd, 0o600)
            except Exception:
                os.close(fd)
                os.unlink(tmp)
                raise
            os.close(fd)
            os.replace(tmp, self.path)
            return decision
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)

    def _decide(self, data: dict, sender: str, contact: str, now: int) -> str | None:
        sender_hits = self._fresh(data, "sender:" + sender, now)
        if len(sender_hits) >= self.sender_max:
            return "sender"
        contact_hits = self._fresh(data, "contact:" + contact, now)
        if len(contact_hits) >= self.contact_max:
            return "contactRef"
        sender_hits.append(now)
        contact_hits.append(now)
        return None


def canonical_intake_request(message: dict) -> str:
    body = {key: message[key] for key in INTAKE_REQUEST_BODY_KEYS}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def verify_intake_request(message, master: bytes, now: int, seen: SeenSet, rates: IntakeRateLimit | None = None) -> dict:
    """Reject a bad intake-request.v1 signature, a timestamp outside 5 minutes, or a reused nonce.

    The seen-set check is atomic. A corrupt seen-set fails closed and does not accept the message.
    untrusted.text is carried as data. It is not a field the verifier treats as instructions.
    """
    out = {"ok": False, "error": None}
    if not isinstance(message, dict) or set(message) != set(INTAKE_REQUEST_KEYS):
        out["error"] = "invalid_schema"
        return out
    if message.get("kind") != "intake-request" or message.get("from") != "intake" or message.get("to") != "lead":
        out["error"] = "invalid_schema"
        return out
    if message.get("action") != "request" or message.get("stage") != "intake" or message.get("humanGate") is not None:
        out["error"] = "invalid_schema"
        return out
    if message.get("senderId") != INTAKE_SENDER_ID:
        out["error"] = "unknown_sender"
        return out
    summary = message.get("summary")
    text = message.get("untrusted")
    refs = message.get("artifactRefs")
    contact = message.get("contactRef")
    if not isinstance(summary, str) or summary == "" or len(summary) > 500:
        out["error"] = "invalid_schema"
        return out
    if not isinstance(text, dict) or set(text) != {"text"} or not isinstance(text.get("text"), str) or len(text["text"]) > 4000:
        out["error"] = "invalid_schema"
        return out
    if not isinstance(refs, list) or len(refs) > 8 or any(not isinstance(item, str) or item == "" or len(item) > 200 for item in refs):
        out["error"] = "invalid_schema"
        return out
    nonce, ts, sig = message.get("nonce"), message.get("ts"), str(message.get("sig", "")).lower()
    if not isinstance(nonce, str) or not HEX_64.fullmatch(nonce) or not isinstance(ts, str) or not DIGITS_10.fullmatch(ts):
        out["error"] = "invalid_schema"
        return out
    if not isinstance(contact, str) or not HEX_64.fullmatch(contact) or not HEX_64.fullmatch(sig):
        out["error"] = "invalid_schema"
        return out
    signed = f"intake-request.v1.{canonical_intake_request(message)}.{nonce}.{ts}"
    want = sign_purpose(master, "intake-request", signed)
    if not hmac.compare_digest(want, sig):
        out["error"] = "bad signature"
        return out
    if abs(int(now) - int(ts)) > INTAKE_REQUEST_WINDOW_SEC:
        out["error"] = "stale"
        return out
    try:
        if seen.reject_or_record(nonce, int(now), ttl=600):
            out["error"] = "reused nonce"
            return out
    except VerifyError:
        out["error"] = "seen set unreadable"
        return out
    if rates is not None:
        bucket = rates.allow(message["senderId"], contact, int(now))
        if bucket:
            out["error"] = "rate_limited"
            out["bucket"] = bucket
            return out
    out["ok"] = True
    return out


def save_verified(path: str, body: bytes) -> None:
    """Write the envelope only after verification, mode 0600, exclusive create."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, body)
    finally:
        os.close(fd)
