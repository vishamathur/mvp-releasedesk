#!/usr/bin/env python3
"""F3 retry cap, F6 seen-set and payload binding, F7 notice strictness."""
import hashlib
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_intake_ref as v  # noqa: E402


def envelope(master: bytes, rid="REQ-20261128-000042", kind="intake-card", ts="1700000000", now=1700000000):
    payload = {"requestId": rid, "kind": kind, "pid": "PID-ER"}
    pj = json.dumps(payload, separators=(",", ":"))
    psha = hashlib.sha256(pj.encode()).hexdigest()
    env_hex = v.sign_purpose(master, "envelope", f"envelope.v1.{ts}.{pj}")
    body = json.dumps({
        "payloadJson": pj,
        "signature": {"alg": "HMAC-SHA256", "ts": ts, "hex": env_hex},
    }).encode()
    sig = v.sign_purpose(master, "notice", f"notice.v1.{ts}.{rid}.{psha}")
    return body, rid, ts, psha, sig, kind, now


class VerifyRefTest(unittest.TestCase):
    def setUp(self):
        self.master = os.urandom(32)

    def test_notice_fields_reject_float_ms_and_bad_hex(self):
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("req-1", "1700000000", "a" * 64, "b" * 64, "intake-card")
        self.assertEqual(ctx.exception.code, "bad requestId")
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("REQ-20261128-000042", "1700000000.5", "a" * 64, "b" * 64, "intake-card")
        self.assertEqual(ctx.exception.code, "bad notice fields")
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("REQ-20261128-000042", "1700000000000", "a" * 64, "b" * 64, "intake-card")
        self.assertEqual(ctx.exception.code, "bad notice fields")
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("REQ-20261128-000042", "1700000000", "A" * 64, "b" * 64, "intake-card")
        self.assertEqual(ctx.exception.code, "bad notice fields")
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("REQ-20261128-000042", "1700000000", "a" * 64, "b" * 64, None)
        self.assertEqual(ctx.exception.code, "bad kind")
        with self.assertRaises(v.VerifyError) as ctx:
            v.check_notice("REQ-20261128-000042", "1700000000", "a" * 64, "b" * 64, "other")
        self.assertEqual(ctx.exception.code, "bad kind")
        self.assertEqual(v.notice_ts("1700000000"), 1700000000)

    def test_envelope_ts_binding_and_kind_from_payload(self):
        body, rid, ts, psha, sig, kind, now = envelope(self.master)
        out = v.verify_envelope(body, rid, ts, psha, sig, kind, self.master, now)
        self.assertTrue(out["ok"])
        self.assertEqual(out["kind"], "intake-card")
        mismatch = v.verify_envelope(body, rid, ts, psha, sig, "visitor-message", self.master, now)
        self.assertFalse(mismatch["ok"])
        self.assertEqual(mismatch["error"], "payload binding")
        env = json.loads(body)
        env["signature"]["ts"] = "1700000000.0"
        bad = v.verify_envelope(json.dumps(env).encode(), rid, ts, psha, sig, kind, self.master, now)
        self.assertEqual(bad["error"], "bad envelope ts")
        wrong = v.verify_envelope(body, rid, ts, psha, "c" * 64, kind, self.master, now)
        self.assertEqual(wrong["error"], "bad signature")

    def test_seen_set_rejects_replay_and_expires(self):
        with tempfile.TemporaryDirectory() as d:
            seen = v.SeenSet(str(Path(d) / ".seen"))
            sig = "ab" * 32
            self.assertFalse(seen.reject_or_record(sig, 1_000, ttl=600))
            self.assertTrue(seen.reject_or_record(sig, 1_100, ttl=600))
            self.assertFalse(seen.reject_or_record(sig, 1_700, ttl=600))
            self.assertEqual(stat.S_IMODE(os.stat(seen.path).st_mode), 0o600)

    def test_seen_set_records_one_winner_under_the_lock(self):
        with tempfile.TemporaryDirectory() as d:
            seen = v.SeenSet(str(Path(d) / ".seen"))
            sig = "cd" * 32
            results = []
            barrier = threading.Barrier(8)

            def once():
                barrier.wait()
                results.append(seen.reject_or_record(sig, 2_000, ttl=600))

            threads = [threading.Thread(target=once) for _ in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(results.count(False), 1)
            self.assertEqual(results.count(True), 7)
            stored = json.loads(Path(seen.path).read_text(encoding="utf-8"))
            self.assertEqual(stored[sig], 2_600)

    def test_save_only_after_ok_and_retry_cap(self):
        body, *_ = envelope(self.master)
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "REQ.json")
            v.save_verified(path, body)
            self.assertEqual(Path(path).read_bytes(), body)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                v.save_verified(path, body)
        self.assertEqual(v.clamp_retry_after("15"), 15)
        self.assertEqual(v.clamp_retry_after("120"), 60)
        self.assertEqual(v.clamp_retry_after("0"), 0)
        self.assertEqual(v.clamp_retry_after("nope"), 0)
        self.assertEqual(v.RETRY_CAP_SEC, 60)

    def test_shared_signing_vector(self):
        vector = json.loads((Path(__file__).resolve().parents[1] / "test" / "fixtures" / "signing-vector.json").read_text(encoding="utf-8"))
        master = vector["master"].encode()
        for row in vector["signatures"]:
            self.assertEqual(v.sign_purpose(master, row["purpose"], row["message"]), row["hex"])

    def test_purpose_keys_differ(self):
        msg = "1700000000.REQ-20261128-000042." + ("a" * 64)
        notice = v.sign_purpose(self.master, "notice", "notice.v1." + msg)
        other = v.sign_purpose(self.master, "lead-to-site", "lead-to-site.v1." + msg)
        self.assertNotEqual(notice, other)
        self.assertEqual(len(notice), 64)

    def test_kind_is_required_and_a_redirect_is_not_followed(self):
        import importlib.util
        from io import StringIO
        from contextlib import redirect_stdout
        spec = importlib.util.spec_from_file_location(
            "verify_intake_tool",
            Path(__file__).resolve().parents[3] / "grok-bots" / "tools" / "verify_intake.py",
        )
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        buf = StringIO()
        with redirect_stdout(buf):
            code = tool.main(["verify_intake.py", "REQ-20261128-000001", "1700000000", "a" * 64, "b" * 64])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(buf.getvalue()), {"ok": False, "error": "kind required"})
        stolen = {"n": 0, "auth": None}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/steal"):
                    stolen["n"] += 1
                    stolen["auth"] = self.headers.get("Authorization")
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"no")
                    return
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:%d/steal" % self.server.server_address[1])
                self.end_headers()

            def log_message(self, fmt, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            body, status = tool.fetch_envelope(
                "http://127.0.0.1:%d/api/envelope.php?requestId=REQ-20261128-000001" % port,
                b"f" * 32,
            )
            self.assertIsNone(body)
            self.assertEqual(status, 302)
            self.assertEqual(stolen["n"], 0)
            self.assertIsNone(stolen["auth"])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
