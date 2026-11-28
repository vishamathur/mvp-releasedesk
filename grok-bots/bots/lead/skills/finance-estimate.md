Skill: finance-estimate (Release Desk Lead; also readable by Change Analyst)
Calls the Grok-backed finance model on the intake site. Output is a RECOMMENDATION for Change Analyst's human finance-approval gate. It never approves.

Call (from your computer; the master secret is the shared box file /workspace/releasedesk-secrets/intake-site-lead-hmac-secret, the same one the site's LEAD_HMAC_SECRET holds; never print it).
Signing (since PR 64): derive the purpose key k = HMAC-SHA256(master, "releasedesk-intake/lead-to-site/v1"), then
X-Intake-Signature = hex HMAC-SHA256(k, "lead-to-site.v1." + ts + "." + rawBody), X-Intake-Timestamp = 10-digit unix seconds (within 300 s).
Signing the old way (HMAC(master, ts + "." + body)) now returns 401 unauthorized.
Send a non-default User-Agent (curl's is fine). Python urllib's default User-Agent is blocked by Cloudflare with 403 "error code: 1010".
  python3 - <<'PY'
  import hmac, hashlib, json, time, urllib.request
  master = open('/workspace/releasedesk-secrets/intake-site-lead-hmac-secret').read().strip().encode()
  k = hmac.new(master, b"releasedesk-intake/lead-to-site/v1", hashlib.sha256).digest()
  body = json.dumps({"requestId":"REQ-…","pid":"PID-ER","text":"<title + description>","urgency":"standard","customerBudgetInr":600000,"catalogueOptionId":"ER-KYC-LABELS","addOns":[],"lines":[]}).encode()
  ts = str(int(time.time()))
  sig = hmac.new(k, b"lead-to-site.v1." + ts.encode() + b"." + body, hashlib.sha256).hexdigest()
  req = urllib.request.Request("https://intake.vishalmathur.org/api/finance-estimate.php", data=body, method="POST",
      headers={"Content-Type":"application/json","X-Intake-Timestamp":ts,"X-Intake-Signature":sig,"User-Agent":"release-desk-lead/1.0"})
  print(urllib.request.urlopen(req, timeout=60).read().decode())
  PY
When the intake-request has catalogueOptionId, pass that id, the same pid, and addOns. The site prices that option's bill of materials (source catalogue-option) and does not map free text. An unknown option or add-on is an error: do not guess a service. Pass "lines":[{"serviceId":"SVC-…","qty":n}] only for an agreed scope that is not a catalogue option (skips Grok mapping).

Response assessment: estimate{lines[serviceId,name,qty,unitPriceInr,riskMultiplier,lineTotalInr,effortDays], subtotalInr, urgencyMultiplier, contingencyPct, totalInr, effortDays, budgetBandsInr{low,expected,high}, artifactRefs}, recommendation approve-recommended|review|reject-suggested, policyReasons, rationale, risks, openQuestions, source grok|explicit-lines|catalogue-option. A catalogue-option estimate includes artifactRef catalogue:<optionId>@<catalogue version>. Also keep finance:<id>@<time> on the handoff.

Model rules (deterministic, Grok can only make it stricter):
- line = unit price x qty x risk multiplier; x urgency (1.00 / 1.15 / 1.30); + contingency 10% (+5% any risk >= 1.3, +5% critical, +5% low mapping confidence). Bands 85% / 100% / 125%.
- reject-suggested: no catalogue match, total > INR 50,00,000, or stated budget < half the low band.
- review: any new customer, ER above INR 5,00,000, a high-risk service, critical urgency, mapping not high-confidence, budget below expected, or suspected prompt injection.
- approve-recommended: everything else (small, clear, low-risk ER).
Use: put artifactRef in artifactRefs and "INR <expected> (bands <low>/<expected>/<high>, excl. GST, EXAMPLE catalogue); finance recommendation <x>" in the summary of the handoff to change-analyst. Change Analyst raises the finance-approval gate; Vishal (Finance partner) decides.
If the call fails, say so and hand off without a number; never invent one.
