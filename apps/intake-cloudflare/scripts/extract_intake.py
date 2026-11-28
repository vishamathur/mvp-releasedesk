#!/usr/bin/env python3
"""Deterministic intake extract (SEC-INTAKE-20261128 F1).

Reads one saved envelope (or a payload object) and prints only typed, validated
fields. Free text never appears in the output: each free-text field is reduced
to its Unicode length and the SHA-256 of its UTF-8 bytes. The source file is
not rewritten. When a path is given, the file must already be mode 0600
(quarantined). This script does not call a model and does not take a secret.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

REQUEST_ID_RE = re.compile(r"^REQ-\d{8}-\d{6}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
PIDS = {"PID-ER", "PID-NC"}
REQUEST_TYPES = {"website-creation", "new-application", "enhancement", "defect", "regulatory"}
URGENCIES = {"standard", "expedited", "critical"}
KINDS = {"intake-card", "visitor-message"}
CATALOGUE = Path(__file__).resolve().parents[2] / "intake" / "private" / "catalogue.example.json"

# Strings under these paths are untrusted free text. Only len + sha256 are emitted.
FREE_TEXT_PATHS = (
    "ask.title",
    "ask.description",
    "ask.notes",
    "message",
    "contact.name",
    "contact.company",
    "contact.email",
    "customer.legalName",
    "customer.jurisdiction",
    "customer.intendedProduct",
    "customer.sponsor",
    "customer.customerId",
    "customer.projectRef",
    "customer.changeType",
    "requestDetails.website.siteName",
    "requestDetails.website.purpose",
    "requestDetails.website.audience",
    "requestDetails.website.pages",
    "requestDetails.website.mustHaveFeatures",
    "requestDetails.website.brandAssets",
    "requestDetails.website.domainHosting",
    "requestDetails.website.style",
    "requestDetails.website.budgetBand",
    "requestDetails.website.deadline",
    "requestDetails.website.styleSource",
    "repository.stack",
    "repository.technicalContact",
    "repository.url",
)

REPO_HOSTS = {"github", "gitlab", "bitbucket", "other"}
REPO_STATES = {"verified", "unverified-host"}
REPO_VISIBILITY = {"public", "private", "unknown"}
CHECKED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
REPO_SLUG_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
REPO_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")


def _digest(text: str) -> dict:
    raw = text.encode("utf-8")
    return {"len": len(text), "sha256": hashlib.sha256(raw).hexdigest()}


def _get(obj, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def load_catalogue(path: Path) -> dict[str, set[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    options: dict[str, set[str]] = {}
    for app in data.get("enhancements") or []:
        for opt in app.get("options") or []:
            oid = opt.get("id")
            if isinstance(oid, str):
                options[oid] = {a.get("id") for a in (opt.get("addOns") or []) if isinstance(a.get("id"), str)}
    for app in data.get("newApplications") or []:
        oid = app.get("id")
        if isinstance(oid, str):
            options[oid] = {a.get("id") for a in (app.get("addOns") or []) if isinstance(a.get("id"), str)}
    return options


def _fail(error: str, quarantine: dict) -> dict:
    return {"ok": False, "error": error, "quarantine": quarantine}


def _repository(repo: object) -> tuple[dict | None, str | None]:
    """Typed repository record for a PID-ER card. Free text (stack, contact, url) is not copied."""
    if not isinstance(repo, dict):
        return None, "bad repository"
    host = repo.get("host")
    name = repo.get("repo")
    branch = repo.get("defaultBranch")
    if host not in REPO_HOSTS or not isinstance(name, str) or name == "" or not isinstance(branch, str) or branch == "":
        return None, "bad repository"
    name_ok = REPO_SLUG_RE.fullmatch(name) is not None
    branch_ok = REPO_BRANCH_RE.fullmatch(branch) is not None
    ver = repo.get("verification")
    if not isinstance(ver, dict):
        return None, "bad repository"
    state = ver.get("state")
    method = ver.get("method")
    visibility = ver.get("visibility")
    checked = ver.get("checkedAt")
    status = ver.get("httpStatus")
    host_branch = ver.get("defaultBranchFromHost")
    if state not in REPO_STATES or not isinstance(method, str) or method == "":
        return None, "bad repository"
    if visibility not in REPO_VISIBILITY or not isinstance(checked, str) or not CHECKED_AT_RE.fullmatch(checked):
        return None, "bad repository"
    if type(status) is not int or status < 0 or status > 599:
        return None, "bad repository"
    if host_branch is not None and not isinstance(host_branch, str):
        return None, "bad repository"
    host_branch_ok = isinstance(host_branch, str) and REPO_BRANCH_RE.fullmatch(host_branch) is not None
    record = {
        "host": host,
        "verification": {
            "state": state,
            "method": method,
            "httpStatus": status,
            "visibility": visibility,
            "defaultBranchFromHost": host_branch if host_branch_ok else "",
            "checkedAt": checked,
        },
    }
    if name_ok:
        record["repo"] = name
    if branch_ok:
        record["defaultBranch"] = branch
    return record, None


def quarantine_for(path: str | None) -> tuple[dict, str | None]:
    if not path:
        return {"path": None, "mode": None, "note": "free text stays in the caller-supplied inbox file; this extract does not copy it"}, None
    st = os.stat(path)
    mode = st.st_mode & 0o777
    info = {
        "path": path,
        "mode": oct(mode),
        "note": "free text remains in this file; this extract does not copy it",
    }
    if mode != 0o600:
        return info, "inbox_not_quarantined"
    return info, None


def extract(document: dict, catalogue: dict[str, set[str]], quarantine: dict) -> dict:
    payload = document
    if isinstance(document.get("payloadJson"), str):
        try:
            payload = json.loads(document["payloadJson"])
        except json.JSONDecodeError:
            return _fail("bad payloadJson", quarantine)
    if not isinstance(payload, dict):
        return _fail("bad payload", quarantine)

    kind = payload.get("kind")
    if kind not in KINDS:
        return _fail("bad kind", quarantine)
    rid = payload.get("requestId")
    if not isinstance(rid, str) or not REQUEST_ID_RE.fullmatch(rid):
        return _fail("bad requestId", quarantine)
    pid = payload.get("pid")
    if pid not in PIDS:
        return _fail("bad pid", quarantine)

    free: dict[str, dict] = {}
    for path in FREE_TEXT_PATHS:
        value = _get(payload, path)
        if isinstance(value, str) and value != "":
            free[path] = _digest(value)
    links = _get(payload, "ask.artifactLinks")
    if isinstance(links, list):
        for i, link in enumerate(links):
            if isinstance(link, str) and link != "":
                free[f"ask.artifactLinks[{i}]"] = _digest(link)

    out = {
        "ok": True,
        "kind": kind,
        "requestId": rid,
        "pid": pid,
        "requestType": None,
        "urgency": None,
        "catalogueOptionId": None,
        "addOns": [],
        "customerBudgetInr": None,
        "contactRef": None,
        "repository": None,
        "freeText": free,
        "quarantine": quarantine,
    }

    contact_ref = _get(payload, "contact.contactRef")
    if isinstance(contact_ref, str):
        if not HEX64_RE.fullmatch(contact_ref):
            return _fail("bad contactRef", quarantine)
        out["contactRef"] = contact_ref

    if kind == "visitor-message":
        if "message" not in free:
            return _fail("bad message", quarantine)
        return out

    request_type = payload.get("requestType")
    if request_type not in REQUEST_TYPES:
        return _fail("bad requestType", quarantine)
    urgency = _get(payload, "ask.urgency")
    if urgency not in URGENCIES:
        return _fail("bad urgency", quarantine)
    option = payload.get("catalogueOptionId")
    if not isinstance(option, str) or option not in catalogue:
        return _fail("bad catalogueOptionId", quarantine)
    raw_adds = payload.get("addOns") if payload.get("addOns") is not None else []
    if not isinstance(raw_adds, list) or any(not isinstance(a, str) for a in raw_adds):
        return _fail("bad addOns", quarantine)
    allowed = catalogue[option]
    if any(a not in allowed for a in raw_adds):
        return _fail("bad addOns", quarantine)
    budget = _get(payload, "ask.customerBudgetInr")
    if budget is None:
        budget_out = None
    elif type(budget) is int and 0 <= budget <= 1_000_000_000:
        budget_out = budget
    else:
        return _fail("bad budget", quarantine)

    out["requestType"] = request_type
    out["urgency"] = urgency
    out["catalogueOptionId"] = option
    out["addOns"] = list(raw_adds)
    out["customerBudgetInr"] = budget_out

    repo = payload.get("repository")
    if pid == "PID-ER":
        extracted, err = _repository(repo)
        if err:
            return _fail(err, quarantine)
        out["repository"] = extracted
    elif repo is not None:
        return _fail("unexpected repository", quarantine)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit a typed, PII-free intake extract.")
    parser.add_argument("--inbox", help="Quarantined envelope file (mode 0600). Reads stdin when omitted.")
    parser.add_argument("--catalogue", type=Path, default=CATALOGUE)
    args = parser.parse_args(argv)
    quarantine, qerr = quarantine_for(args.inbox)
    if qerr:
        json.dump(_fail(qerr, quarantine), sys.stdout)
        sys.stdout.write("\n")
        return 1
    raw = Path(args.inbox).read_bytes() if args.inbox else sys.stdin.buffer.read()
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        json.dump(_fail("bad json", quarantine), sys.stdout)
        sys.stdout.write("\n")
        return 1
    if not isinstance(document, dict):
        json.dump(_fail("bad json", quarantine), sys.stdout)
        sys.stdout.write("\n")
        return 1
    try:
        catalogue = load_catalogue(args.catalogue)
    except (OSError, json.JSONDecodeError, TypeError):
        json.dump(_fail("bad catalogue", quarantine), sys.stdout)
        sys.stdout.write("\n")
        return 1
    result = extract(document, catalogue, quarantine)
    json.dump(result, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
