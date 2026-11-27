// Port of apps/intake/tests/integration-tests.php, run against the worker's fetch handler with D1 (node:sqlite).
// Grok is not called. A missing key is an error. Any unexpected network call fails the test.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, signedReq, getReq, call, count, blockNetwork, ER, ORIGIN, testKey } from "./helpers.mjs";

let restore;
beforeEach(() => { restore = blockNetwork(); });
afterEach(() => restore());

test("catalogue endpoint returns EXAMPLE services, enhancements and new applications", async () => {
  const env = testEnv();
  const { status, json, headers } = await call(worker, env, getReq("/api/catalogue.php"));
  assert.equal(status, 200);
  assert.equal(json.services.length, 13);
  assert.ok(json.label.includes("EXAMPLE DATA - illustrative prices only"));
  assert.equal(headers.get("Cache-Control"), "public, max-age=300");
  assert.ok(json.enhancements[0].options[0].billOfMaterials && json.newApplications[0].billOfMaterials);
  const ids = [];
  for (const app of json.enhancements) for (const opt of app.options) ids.push(opt.id);
  for (const app of json.newApplications) { ids.push(app.id); for (const add of app.addOns) ids.push(add.id); }
  assert.ok(ids.includes("ER-KYC-LABELS") && ids.includes("NC-KYC"));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal((await call(worker, env, jsonReq("/api/catalogue.php", {}))).status, 405);
});

test("chat without GROK_API_KEY is a configuration error", async () => {
  const env = testEnv();
  const { status, json } = await call(worker, env, jsonReq("/api/chat.php", { route: "er", messages: [{ role: "user", content: "Rename two labels" }] }));
  assert.equal(status, 503); assert.equal(json.error, "grok_unavailable"); assert.ok(json.message.includes("GROK_API_KEY is not set"));
  assert.ok(!("reply" in json));
});

test("chat with a key but no sessionId refuses before any network call", async () => {
  const env = testEnv({ GROK_API_KEY: testKey() });
  const { status, json } = await call(worker, env, jsonReq("/api/chat.php", { route: "er", messages: [{ role: "user", content: "Hello" }] }));
  assert.equal(status, 503); assert.ok(json.message.includes("sessionId is required"));
});

test("grok call: url, bearer key, strict schema, 30 s timeout; a network failure is a real error", async () => {
  let seen = null;
  globalThis.fetch = async (url, init) => { seen = { url, init }; throw new TypeError("network disabled in tests"); };
  const env = testEnv({ GROK_API_KEY: testKey() });
  const { status, json } = await call(worker, env, jsonReq("/api/chat.php", { route: "er", sessionId: "sess_12345678", messages: [{ role: "user", content: "Mail me at a@b.co or +91 98765 43210" }] }));
  assert.equal(status, 503); assert.equal(json.error, "grok_unavailable");
  assert.ok(json.message.startsWith("Grok chat failed (grok_transport:network disabled in tests)"), json.message);
  assert.equal(seen.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, `Bearer ${env.GROK_API_KEY}`);
  assert.ok(seen.init.signal instanceof AbortSignal);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "grok-4.3"); assert.equal(body.max_tokens, 900);
  assert.equal(body.response_format.json_schema.name, "intake_chat"); assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.safety_identifier, createHash("sha256").update("sess_12345678").digest("hex"));
  assert.deepEqual(body.guidelines.map((g) => g.category), ["nsfw", "violence", "profanity"]);
  assert.ok(body.messages[1].content.includes("<visitor_input>\nvisitor: Mail me at [email given - type it in the form] or [phone hidden]\n</visitor_input>"), body.messages[1].content);
  assert.ok(!body.messages[1].content.includes("a@b.co"));
});

test("intake with a valid catalogue option is priced from the bill of materials", async () => {
  const env = testEnv();
  const before = count(env, "submissions");
  const { status, json } = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(status, 200, JSON.stringify(json)); assert.equal(json.ok, true); assert.match(json.referenceId, /^REQ-\d{8}-\d{6}$/);
  assert.match(json.statusToken, /^[a-f0-9]{32}$/);
  const card = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(json.referenceId).card_json);
  assert.equal(card.catalogueOptionId, "ER-KYC-LABELS"); assert.equal(card.pid, "PID-ER");
  assert.equal(card.finance.source, "catalogue-option"); assert.equal(card.finance.estimate.totalInr, 187000);
  assert.ok(card.finance.estimate.artifactRefs.includes("catalogue:ER-KYC-LABELS@example-2026-11"));
  assert.equal(count(env, "submissions"), before + 1);
  const st = env.DB.raw.prepare("SELECT token_hash, status FROM status WHERE request_id = ?").get(json.referenceId);
  assert.equal(st.status, "received"); assert.equal(st.token_hash, createHash("sha256").update(json.statusToken).digest("hex"));
  const out = env.DB.raw.prepare("SELECT state, attempts, envelope_json FROM outbox WHERE request_id = ?").get(json.referenceId);
  assert.equal(out.state, "queued"); assert.equal(out.attempts, 0);
  const envl = JSON.parse(out.envelope_json);
  assert.equal(envl.kind, "intake-card"); assert.equal(envl.to, "release-desk-lead"); assert.equal(envl.untrusted, true);
  assert.equal(envl.signature.hex, createHmac("sha256", env.LEAD_HMAC_SECRET).update(`${envl.signature.ts}.${envl.payloadJson}`).digest("hex"));
});

test("showcase options are priced and can be submitted", async () => {
  const env = testEnv();
  const { json: cat } = await call(worker, env, getReq("/api/catalogue.php"));
  const found = {};
  for (const app of cat.enhancements) for (const opt of app.options) found[opt.id] = opt;
  for (const app of cat.newApplications) found[app.id] = app;
  assert.equal(found["SX-HELPDESK-BOT"].exampleEstimate.totalInr, 1286850);
  assert.equal(found["SX-LIVE-REVIEW"].exampleEstimate.totalInr, 385000);
  assert.equal(found["SX-LANDING-PAGE"].exampleEstimate.totalInr, 836000);
  assert.ok(found["SX-HELPDESK-BOT"].showcase45 === true && found["SX-LIVE-REVIEW"].showcase45 === true && found["SX-LANDING-PAGE"].showcase45 === true);
  const before = count(env, "submissions");
  const cardOf = (rid) => JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(rid).card_json);
  let r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, catalogueOptionId: "SX-HELPDESK-BOT" }));
  assert.equal(r.status, 200, r.text);
  assert.equal(cardOf(r.json.referenceId).finance.estimate.totalInr, 1286850);
  const nc = { route: "new_customer", pid: "PID-NC", catalogueOptionId: "SX-LANDING-PAGE", addOns: [],
    contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd",
    jurisdiction: "India", intendedProduct: "Lending", sponsor: "R. Rao, CFO",
    title: "Marketing landing page", description: "A marketing landing page for a new product launch.", urgency: "standard", website: "", consent: true };
  r = await call(worker, env, jsonReq("/api/intake.php", nc));
  assert.equal(r.status, 200, r.text);
  const ncCard = cardOf(r.json.referenceId);
  assert.equal(ncCard.pid, "PID-NC"); assert.equal(ncCard.finance.estimate.totalInr, 836000);
  assert.ok(r.json.message.includes("new-customer request"));
  r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, catalogueOptionId: "SX-LIVE-REVIEW" }));
  assert.equal(r.status, 200);
  const live = cardOf(r.json.referenceId);
  assert.equal(live.finance.source, "catalogue-option"); assert.equal(live.finance.estimate.totalInr, 385000);
  assert.equal(count(env, "submissions"), before + 3);
});

test("website creation: catalogue lists it first, a submission stores the brief and runs PID-NC", async () => {
  const env = testEnv();
  const { json: cat } = await call(worker, env, getReq("/api/catalogue.php"));
  const first = cat.newApplications[0];
  assert.equal(first.id, "NC-WEBSITE"); assert.equal(first.name, "Website creation"); assert.equal(first.addOns.length, 3);
  const est = first.exampleEstimate?.totalInr ?? 0;
  assert.ok(est > 0 && cat.label.includes("EXAMPLE DATA - illustrative prices only"));
  const web = { route: "website", pid: "PID-NC", catalogueOptionId: "NC-WEBSITE", addOns: ["ADD-NC-WEB-FORMS"],
    contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd", jurisdiction: "India", sponsor: "R. Rao, CFO",
    siteName: "Acme Lending", purpose: "Explain our lending products and collect enquiries.", audience: "Small business owners",
    pages: "Home, Products, About, Contact", mustHaveFeatures: "Contact form", brandAssets: "Logo exists", domainHosting: "We own the domain",
    budgetBand: "300k_plus", desiredBy: "2027-01-31", urgency: "standard", artifactLinks: [], website: "", consent: true };
  const before = count(env, "submissions");
  let r = await call(worker, env, jsonReq("/api/intake.php", web));
  assert.equal(r.status, 200, r.text); assert.equal(r.json.ok, true); assert.ok(r.json.message.includes("website creation request"), r.json.message);
  const card = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.equal(card.pid, "PID-NC"); assert.equal(card.requestType, "website-creation"); assert.equal(card.catalogueOptionId, "NC-WEBSITE"); assert.deepEqual(card.addOns, ["ADD-NC-WEB-FORMS"]);
  assert.equal(card.requestDetails.website.pages, "Home, Products, About, Contact"); assert.equal(card.requestDetails.website.deadline, "2027-01-31");
  assert.equal(card.finance.source, "catalogue-option"); assert.ok(card.finance.estimate.totalInr > est, "priced from the catalogue with the add-on, no Grok");
  assert.equal(card.proposedHandoff.stage, "discovery"); assert.equal(card.proposedHandoff.to, "change-analyst"); assert.equal(card.customer.intendedProduct, "Website: Acme Lending");
  assert.ok(card.ask.description.includes("Purpose: Explain our lending products"), "description composed from the brief");
  const envl = JSON.parse(env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE request_id = ?").get(r.json.referenceId).envelope_json);
  assert.equal(JSON.parse(envl.payloadJson).requestType, "website-creation", "the signed envelope carries the type");
  assert.equal(count(env, "submissions"), before + 1);
  // A website request cannot use a template that is not a website template, and cannot skip the brief.
  r = await call(worker, env, jsonReq("/api/intake.php", { ...web, catalogueOptionId: "NC-KYC" }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("catalogueOptionId"), r.text);
  r = await call(worker, env, jsonReq("/api/intake.php", { ...web, pages: "", purpose: "" }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("pages") && r.json.fields.includes("purpose"), r.text);
  assert.equal(count(env, "submissions"), before + 1, "rejected requests store nothing");
});

test("intake with an invalid catalogue option is rejected", async () => {
  const env = testEnv();
  let r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, catalogueOptionId: "NO-SUCH" }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("catalogueOptionId"));
  r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, catalogueOptionId: "NC-KYC", pid: "PID-ER" }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("pid"));
  assert.equal(count(env, "submissions"), 0);
});

test("validation, honeypot, origin, content-type, size", async () => {
  const env = testEnv();
  let r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, customerId: "", consent: false }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("customerId") && r.json.fields.includes("consent"));
  r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, customerId: "CUST-1042" }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("customerId"));
  const n = count(env, "submissions");
  r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, website: "x" }));
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(count(env, "submissions"), n); assert.equal(count(env, "outbox"), 0);
  r = await call(worker, env, jsonReq("/api/intake.php", ER, { Origin: "https://evil.example" })); assert.equal(r.status, 403); assert.equal(r.json.error, "forbidden_origin");
  r = await call(worker, env, jsonReq("/api/intake.php", "a=b", { "Content-Type": "text/plain" })); assert.equal(r.status, 415);
  r = await call(worker, env, jsonReq("/api/intake.php", { ...ER, description: "x".repeat(20000) })); assert.equal(r.status, 413);
  r = await call(worker, env, jsonReq("/api/intake.php", "[1,2]")); assert.equal(r.status, 400); assert.equal(r.json.error, "bad_json");
  r = await call(worker, env, jsonReq("/api/intake.php", "{bad")); assert.equal(r.status, 400);
  r = await call(worker, env, getReq("/api/intake.php")); assert.equal(r.status, 405);
});

test("rate limit: intake allows RATE_LIMIT_MAX per window per IP, then 429 with Retry-After", async () => {
  const env = testEnv({ RATE_LIMIT_MAX: "2" });
  const bad = { ...ER, consent: false };
  assert.equal((await call(worker, env, jsonReq("/api/intake.php", bad))).status, 400);
  assert.equal((await call(worker, env, jsonReq("/api/intake.php", bad))).status, 400);
  const r = await call(worker, env, jsonReq("/api/intake.php", bad));
  assert.equal(r.status, 429); assert.equal(r.json.error, "rate_limited");
  const retry = Number(r.headers.get("Retry-After")); assert.ok(retry >= 1 && retry <= 600, String(retry));
  assert.equal((await call(worker, env, jsonReq("/api/intake.php", bad, { "CF-Connecting-IP": "203.0.113.99" }))).status, 400, "other IP");
  const buckets = env.DB.raw.prepare("SELECT DISTINCT bucket FROM rate_hits").all().map((x) => x.bucket);
  assert.ok(buckets.every((b) => /^[a-f0-9]{64}$/.test(b)), "IP is hashed");
});

test("lead-update and status use a seeded record, not a Grok result", async () => {
  const env = testEnv();
  const requestId = "REQ-20261122-000777";
  const token = "0123456789abcdef0123456789abcdef";
  env.DB.raw.prepare("INSERT INTO status (request_id, pid, token_hash, status, update_ids_json, history_json, version, created_at, updated_at) VALUES (?, 'PID-ER', ?, 'received', '[]', ?, 0, ?, ?)")
    .run(requestId, createHash("sha256").update(token).digest("hex"), JSON.stringify([{ at: "2026-11-22T12:00:00Z", status: "received", from: "site", message: "Request received and sent to Release Desk Lead." }]), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
  let r = await call(worker, env, getReq(`/api/status.php?ref=${requestId}&token=${token}`));
  assert.equal(r.status, 200); assert.equal(r.json.status, "received");
  assert.deepEqual(r.json.steps.map((s) => s.state), ["current", "todo", "todo", "todo", "todo", "todo", "todo"]);
  r = await call(worker, env, getReq(`/api/status.php?ref=${requestId}&token=${"0".repeat(32)}`)); assert.equal(r.status, 404);
  const u = { requestId, updateId: "lead-u-1", from: "lead", stage: "finance-approval", message: "Estimate ready. Finance review is next.",
    nextGate: { gate: "finance-approval", owner: "change-analyst" }, quote: { totalInr: 187000, budgetBandsInr: { low: 159000, expected: 187000, high: 234000 },
      lines: [{ serviceId: "SVC-UI-S", name: "UI change - small", qty: 2, lineTotalInr: 90000 }] } };
  r = await call(worker, env, new Request(ORIGIN + "/api/lead-update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) }));
  assert.equal(r.status, 401);
  r = await call(worker, env, signedReq("/api/lead-update.php", u, env.LEAD_HMAC_SECRET)); assert.equal(r.status, 200, r.text); assert.equal(r.json.status, "finance-approval");
  r = await call(worker, env, getReq(`/api/status.php?ref=${requestId}&token=${token}`));
  assert.equal(r.json.status, "finance-approval"); assert.equal(r.json.quote.totalInr, 187000); assert.equal(r.json.nextGate.owner, "change-analyst");
  assert.ok(r.json.quote.note.includes("EXAMPLE"));
  // idempotent on updateId, backwards move is 409, stale or wrong signature is 401
  r = await call(worker, env, signedReq("/api/lead-update.php", u, env.LEAD_HMAC_SECRET)); assert.equal(r.status, 200); assert.equal(r.json.duplicate, true);
  r = await call(worker, env, signedReq("/api/lead-update.php", { ...u, updateId: "lead-u-2", stage: "intake", nextGate: undefined, quote: undefined }, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 409); assert.equal(r.json.error, "bad_transition");
  r = await call(worker, env, signedReq("/api/lead-update.php", { ...u, updateId: "lead-u-3" }, env.LEAD_HMAC_SECRET, Math.floor(Date.now() / 1000) - 301)); assert.equal(r.status, 401);
  r = await call(worker, env, signedReq("/api/lead-update.php", { ...u, updateId: "lead-u-4" }, "f".repeat(64))); assert.equal(r.status, 401);
  r = await call(worker, env, signedReq("/api/lead-update.php", { ...u, updateId: "lead-u-5", requestId: "REQ-20261122-000778" }, env.LEAD_HMAC_SECRET)); assert.equal(r.status, 404);
  r = await call(worker, env, signedReq("/api/lead-update.php", { ...u, updateId: "lead-u-6", message: "Approved." }, env.LEAD_HMAC_SECRET)); assert.equal(r.status, 400);
});

test("lead-update with a short HMAC secret is unauthorized (secret must be >= 32 bytes)", async () => {
  const env = testEnv({ LEAD_HMAC_SECRET: "short" });
  const r = await call(worker, env, signedReq("/api/lead-update.php", { requestId: "REQ-20261122-000777" }, "short"));
  assert.equal(r.status, 401);
  const ev = env.DB.raw.prepare("SELECT event_json FROM events").all().map((x) => JSON.parse(x.event_json));
  assert.deepEqual(ev.at(-1), { event: "lead_update_auth_failed", why: "lead_secret_not_configured" });
});

test("visitor message on the status page goes to the outbox; closed requests refuse", async () => {
  const env = testEnv();
  const { json } = await call(worker, env, jsonReq("/api/intake.php", ER));
  let r = await call(worker, env, jsonReq("/api/status.php", { ref: json.referenceId, token: json.statusToken, message: "Any update?" }));
  assert.equal(r.status, 200, r.text);
  const row = env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE kind = 'visitor-message'").get();
  const envl = JSON.parse(row.envelope_json);
  const vp = JSON.parse(envl.payloadJson); assert.equal(vp.message, "Any update?"); assert.equal(vp.currentPublicStatus, "received");
  r = await call(worker, env, jsonReq("/api/status.php", { ref: json.referenceId, token: json.statusToken, message: "x" })); assert.equal(r.status, 400);
  r = await call(worker, env, jsonReq("/api/status.php", { ref: json.referenceId, token: "0".repeat(32), message: "hello" })); assert.equal(r.status, 404);
  env.DB.raw.prepare("UPDATE status SET status = 'rejected' WHERE request_id = ?").run(json.referenceId);
  r = await call(worker, env, jsonReq("/api/status.php", { ref: json.referenceId, token: json.statusToken, message: "hello" })); assert.equal(r.status, 409);
});

test("finance-estimate endpoint uses explicit lines and does not call Grok", async () => {
  const env = testEnv();
  const b = { requestId: "REQ-20261122-000001", pid: "PID-ER", text: "", lines: [{ serviceId: "SVC-SEC", qty: 1 }], urgency: "expedited" };
  let r = await call(worker, env, new Request(ORIGIN + "/api/finance-estimate.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }));
  assert.equal(r.status, 401);
  r = await call(worker, env, signedReq("/api/finance-estimate.php", b, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 200, r.text); assert.equal(r.json.assessment.estimate.totalInr, 253000); assert.equal(r.json.assessment.source, "explicit-lines");
  assert.match(r.json.assessment.artifactRef, /^finance:REQ-20261122-000001@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(count(env, "finance_artifacts"), 1);
});

test("finance-estimate prices a catalogue option; bad option or pid is HTTP 400 catalogue", async () => {
  const env = testEnv();
  let r = await call(worker, env, signedReq("/api/finance-estimate.php", { pid: "PID-NC", catalogueOptionId: "NC-KYC", addOns: ["ADD-NC-KYC-API"] }, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 200, r.text); assert.equal(r.json.assessment.estimate.totalInr, 1907850); assert.equal(r.json.assessment.source, "catalogue-option");
  r = await call(worker, env, signedReq("/api/finance-estimate.php", { pid: "PID-ER", catalogueOptionId: "NC-KYC" }, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 400); assert.equal(r.json.error, "catalogue");
  r = await call(worker, env, signedReq("/api/finance-estimate.php", { pid: "PID-NC", catalogueOptionId: "NC-KYC", addOns: ["NOPE"] }, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 400); assert.equal(r.json.error, "catalogue");
});

test("finance-estimate without lines or a key is a configuration error", async () => {
  const env = testEnv();
  const r = await call(worker, env, signedReq("/api/finance-estimate.php", { pid: "PID-ER", text: "Rename two labels" }, env.LEAD_HMAC_SECRET));
  assert.equal(r.status, 503); assert.ok(r.json.message.includes("GROK_API_KEY is not set"));
});

test("responses do not echo a key", async () => {
  const env = testEnv({ GROK_API_KEY: testKey() });
  const r = await call(worker, env, jsonReq("/api/chat.php", { route: "er", messages: [{ role: "user", content: "Hello" }] }));
  assert.ok(!r.text.includes(env.GROK_API_KEY) && !r.text.includes(env.LEAD_HMAC_SECRET));
  for (const row of env.DB.raw.prepare("SELECT event_json FROM events").all()) assert.ok(!row.event_json.includes(env.GROK_API_KEY));
});

test("router: unknown /api path is 403, missing DB is 503 not_configured, other paths go to static assets", async () => {
  const env = testEnv();
  assert.equal((await call(worker, env, getReq("/api/bootstrap.php"))).status, 403);
  assert.equal((await call(worker, env, getReq("/api/drain-outbox.php"))).status, 403);
  const r = await call(worker, { ...env, DB: undefined }, getReq("/api/catalogue.php"));
  assert.equal(r.status, 503); assert.equal(r.json.error, "not_configured");
  const assets = { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`, { status: 200, headers: { "Content-Type": "text/html" } }) };
  const s = await call(worker, { ...env, ASSETS: assets }, getReq("/index.html"));
  assert.equal(s.text, "asset /index.html"); assert.equal(s.headers.get("X-Frame-Options"), "DENY");
  const api = await call(worker, env, getReq("/api/catalogue.php"));
  assert.ok(api.headers.get("Content-Security-Policy").includes("default-src 'self'"));
  const redirect = await worker.fetch(new Request("http://intake.vishalmathur.org/x"), env, {});
  assert.equal(redirect.status, 301); assert.equal(redirect.headers.get("Location"), "https://intake.vishalmathur.org/x");
});
