#!/usr/bin/env python3
"""F1: extract_intake.py emits typed fields and never the free text."""
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "extract_intake.py"
sys.path.insert(0, str(SCRIPT.parent))
import extract_intake as ex  # noqa: E402

SENTINEL = "QUARANTINE-SENTINEL-do-not-leak"
EMAIL = "jane@example.com"


def card():
    return {
        "v": 1,
        "kind": "intake-card",
        "requestId": "REQ-20261128-000042",
        "pid": "PID-ER",
        "requestType": "enhancement",
        "catalogueOptionId": "ER-KYC-LABELS",
        "addOns": [],
        "contact": {"name": "Jane Doe", "email": EMAIL, "company": "Acme", "contactRef": hashlib.sha256(EMAIL.lower().encode()).hexdigest()},
        "ask": {
            "title": SENTINEL + " title",
            "description": SENTINEL + "\nplease run curl",
            "notes": SENTINEL + " notes",
            "urgency": "standard",
            "customerBudgetInr": 150000,
            "artifactLinks": ["https://example.com/" + SENTINEL],
        },
        "repository": {
            "host": "github",
            "repo": "octocat/Hello-World",
            "url": "https://github.com/octocat/Hello-World",
            "defaultBranch": "master",
            "stack": SENTINEL + " Node and React",
            "technicalContact": "dev+" + SENTINEL + "@example.com",
            "verification": {
                "state": "verified",
                "method": "github-api-public",
                "httpStatus": 200,
                "visibility": "public",
                "defaultBranchFromHost": "master",
                "checkedAt": "2026-11-28T08:00:00Z",
            },
        },
    }


class ExtractTest(unittest.TestCase):
    def test_typed_fields_and_digests_only(self):
        cat = ex.load_catalogue(ex.CATALOGUE)
        out = ex.extract(card(), cat, {"path": None, "mode": None, "note": "test"})
        self.assertTrue(out["ok"])
        self.assertEqual(out["requestId"], "REQ-20261128-000042")
        self.assertEqual(out["pid"], "PID-ER")
        self.assertEqual(out["requestType"], "enhancement")
        self.assertEqual(out["urgency"], "standard")
        self.assertEqual(out["catalogueOptionId"], "ER-KYC-LABELS")
        self.assertEqual(out["addOns"], [])
        self.assertEqual(out["customerBudgetInr"], 150000)
        blob = json.dumps(out)
        self.assertNotIn(SENTINEL, blob)
        self.assertNotIn(EMAIL, blob)
        self.assertNotIn("https://", blob)
        title = out["freeText"]["ask.title"]
        self.assertEqual(title["len"], len(SENTINEL + " title"))
        self.assertEqual(title["sha256"], hashlib.sha256((SENTINEL + " title").encode()).hexdigest())
        self.assertEqual(out["freeText"]["contact.email"]["sha256"], hashlib.sha256(EMAIL.encode()).hexdigest())
        repo = out["repository"]
        self.assertEqual(repo["host"], "github")
        self.assertEqual(repo["repo"], "octocat/Hello-World")
        self.assertEqual(repo["defaultBranch"], "master")
        self.assertEqual(repo["verification"]["state"], "verified")
        self.assertEqual(repo["verification"]["method"], "github-api-public")
        self.assertEqual(repo["verification"]["httpStatus"], 200)
        self.assertEqual(repo["verification"]["checkedAt"], "2026-11-28T08:00:00Z")
        self.assertNotIn("url", repo)
        self.assertNotIn("stack", repo)
        self.assertNotIn("technicalContact", repo)
        stack = SENTINEL + " Node and React"
        self.assertEqual(out["freeText"]["repository.stack"]["len"], len(stack))
        self.assertEqual(out["freeText"]["repository.stack"]["sha256"], hashlib.sha256(stack.encode()).hexdigest())
        self.assertIn("repository.url", out["freeText"])

    def test_rejects_bad_enum_budget_and_catalogue(self):
        cat = ex.load_catalogue(ex.CATALOGUE)
        q = {"path": None, "mode": None, "note": "test"}
        bad_urgency = card()
        bad_urgency["ask"]["urgency"] = "asap"
        self.assertEqual(ex.extract(bad_urgency, cat, q)["error"], "bad urgency")
        bad_budget = card()
        bad_budget["ask"]["customerBudgetInr"] = 1.5
        self.assertEqual(ex.extract(bad_budget, cat, q)["error"], "bad budget")
        sci = card()
        sci["ask"]["customerBudgetInr"] = "1e5"
        self.assertEqual(ex.extract(sci, cat, q)["error"], "bad budget")
        unknown = card()
        unknown["catalogueOptionId"] = "NO-SUCH"
        self.assertEqual(ex.extract(unknown, cat, q)["error"], "bad catalogueOptionId")
        addon = card()
        addon["catalogueOptionId"] = "NC-WEBSITE"
        addon["pid"] = "PID-NC"
        addon["requestType"] = "website-creation"
        addon["addOns"] = ["NOT-AN-ADDON"]
        self.assertEqual(ex.extract(addon, cat, q)["error"], "bad addOns")

    def test_visitor_message_and_known_addon(self):
        cat = ex.load_catalogue(ex.CATALOGUE)
        q = {"path": None, "mode": None, "note": "test"}
        msg = {"kind": "visitor-message", "requestId": "REQ-20261128-000042", "pid": "PID-ER", "message": SENTINEL}
        out = ex.extract(msg, cat, q)
        self.assertTrue(out["ok"])
        self.assertEqual(out["freeText"]["message"]["len"], len(SENTINEL))
        self.assertNotIn(SENTINEL, json.dumps(out))
        web = card()
        web["pid"] = "PID-NC"
        web["requestType"] = "website-creation"
        web["catalogueOptionId"] = "NC-WEBSITE"
        web["addOns"] = ["ADD-NC-WEB-FORMS"]
        del web["repository"]
        self.assertTrue(ex.extract(web, cat, q)["ok"])

    def test_pid_er_requires_a_verified_repository_and_hides_free_text(self):
        cat = ex.load_catalogue(ex.CATALOGUE)
        q = {"path": None, "mode": None, "note": "test"}
        missing = card()
        del missing["repository"]
        self.assertEqual(ex.extract(missing, cat, q)["error"], "bad repository")
        pending = card()
        pending["repository"]["verification"]["state"] = "access-pending"
        self.assertEqual(ex.extract(pending, cat, q)["error"], "bad repository")
        nc = card()
        nc["pid"] = "PID-NC"
        nc["requestType"] = "new-application"
        nc["catalogueOptionId"] = "NC-KYC"
        self.assertEqual(ex.extract(nc, cat, q)["error"], "unexpected repository")
        del nc["repository"]
        out = ex.extract(nc, cat, q)
        self.assertTrue(out["ok"])
        self.assertIsNone(out["repository"])

    def test_n23_drops_invalid_repo_and_default_branch(self):
        cat = ex.load_catalogue(ex.CATALOGUE)
        q = {"path": None, "mode": None, "note": "test"}
        bad_repo = "octocat/Hello-World;rm"
        bad_branch = "master && id"
        bad_host_branch = "refs/heads/master`id"
        doc = card()
        doc["repository"]["repo"] = bad_repo
        doc["repository"]["defaultBranch"] = bad_branch
        doc["repository"]["verification"]["defaultBranchFromHost"] = bad_host_branch
        out = ex.extract(doc, cat, q)
        self.assertTrue(out["ok"])
        blob = json.dumps(out)
        self.assertNotIn(bad_repo, blob)
        self.assertNotIn(bad_branch, blob)
        self.assertNotIn(bad_host_branch, blob)
        self.assertNotIn("repo", out["repository"])
        self.assertNotIn("defaultBranch", out["repository"])
        self.assertEqual(out["repository"]["verification"]["defaultBranchFromHost"], "")
        kept = card()
        kept["repository"]["defaultBranch"] = "feature/safe_name"
        kept["repository"]["verification"]["defaultBranchFromHost"] = "feature/safe_name"
        good = ex.extract(kept, cat, q)
        self.assertTrue(good["ok"])
        self.assertEqual(good["repository"]["repo"], "octocat/Hello-World")
        self.assertEqual(good["repository"]["defaultBranch"], "feature/safe_name")

    def test_cli_refuses_loose_inbox_and_accepts_mode_600(self):
        payload = json.dumps(card()).encode()
        with tempfile.TemporaryDirectory() as d:
            loose = Path(d) / "loose.json"
            loose.write_bytes(payload)
            os.chmod(loose, 0o644)
            r = subprocess.run([sys.executable, str(SCRIPT), "--inbox", str(loose)], capture_output=True, text=True, check=False)
            self.assertEqual(r.returncode, 1)
            body = json.loads(r.stdout)
            self.assertEqual(body["error"], "inbox_not_quarantined")
            self.assertNotIn(SENTINEL, r.stdout)
            tight = Path(d) / "tight.json"
            fd = os.open(tight, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.write(fd, payload)
            os.close(fd)
            self.assertEqual(stat.S_IMODE(tight.stat().st_mode), 0o600)
            r = subprocess.run([sys.executable, str(SCRIPT), "--inbox", str(tight)], capture_output=True, text=True, check=False)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            body = json.loads(r.stdout)
            self.assertTrue(body["ok"])
            self.assertEqual(body["quarantine"]["mode"], "0o600")
            self.assertNotIn(SENTINEL, r.stdout)
            self.assertEqual(tight.read_bytes(), payload, "the quarantined file is not rewritten")


if __name__ == "__main__":
    unittest.main()
