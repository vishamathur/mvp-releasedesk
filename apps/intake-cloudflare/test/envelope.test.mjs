// Webhook notice + fetch-back (Cloudflare build only). Lead's run sees only the wake text (cut at about 5 KB), so the
// webhook carries a small signed notice and Lead fetches the full envelope from GET api/envelope.php.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { ORIGIN, testEnv, jsonReq, call, blockNetwork, ER, purposeSign } from "./helpers.mjs";

const HOOK = "https://lead-webhook.invalid/hook";
const FETCH_KEY = "f".repeat(64);
let restore, calls;
beforeEach(() => {
  restore = blockNetwork(); calls = [];
  globalThis.fetch = async (url, init) => {
    if (url !== HOOK) throw new Error("unexpected url " + url);
    calls.push({ raw: init.body, body: JSON.parse(init.body) });
    return new Response("{}", { status: 202 });
  };
});
afterEach(() => restore());
const envOf = (extra = {}) => testEnv({ LEAD_DELIVERY: "webhook", LEAD_WEBHOOK_URL: HOOK, LEAD_WEBHOOK_KEY: "routine-key-not-real", LEAD_FETCH_KEY: FETCH_KEY, ...extra });
const getEnv = (q, key = FETCH_KEY) => new Request(`${ORIGIN}/api/envelope.php?${q}`, { headers: key === null ? {} : { Authorization: `Bearer ${key}` } });

const bigWebsite = { route: "website", pid: "PID-NC", catalogueOptionId: "NC-WEBSITE", addOns: ["ADD-NC-WEB-SITE", "ADD-NC-WEB-FORMS", "ADD-NC-WEB-AI"],
  contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd", jurisdiction: "India", sponsor: "R. Rao, CFO",
  siteName: "Acme Lending", purpose: "P\"".repeat(300), audience: "A".repeat(300), pages: "Home, \"Products\", ".repeat(30).slice(0, 600),
  mustHaveFeatures: "F".repeat(600), brandAssets: "B".repeat(400), domainHosting: "D".repeat(300), budgetBand: "300k_plus", desiredBy: "2027-01-31",
  title: "T".repeat(150), description: "Notes \u00e9\u4e2d\n".repeat(500).slice(0, 4000), urgency: "critical", artifactLinks: [], website: "", consent: true };

test("notice: under 2 KB even for the largest website card, signed over ts.requestId.payloadSha256", async () => {
  const env = envOf();
  const r = await call(worker, env, jsonReq("/api/intake.php", bigWebsite));
  assert.equal(r.status, 200, r.text);
  const { raw, body } = calls[0];
  assert.ok(Buffer.byteLength(raw) < 2048, `notice ${Buffer.byteLength(raw)} bytes`);
  assert.ok(Buffer.byteLength(raw) < 400, "in practice the notice is a few hundred bytes");
  assert.deepEqual(Object.keys(body), ["source", "kind", "requestId", "ts", "payloadSha256", "sig"]);
  assert.match(body.ts, /^\d+$/); assert.match(body.payloadSha256, /^[a-f0-9]{64}$/); assert.match(body.sig, /^[a-f0-9]{64}$/);
  assert.equal(body.sig, purposeSign(env.LEAD_HMAC_SECRET, "notice", `notice.v1.${body.ts}.${body.requestId}.${body.payloadSha256}`));
  const stored = env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE request_id = ?").get(body.requestId).envelope_json;
  assert.ok(stored.length > 8168, "the stored envelope is the full card, not trimmed");
  assert.equal(body.payloadSha256, createHash("sha256").update(JSON.parse(stored).payloadJson).digest("hex"));
  // A wrong secret does not verify.
  assert.notEqual(body.sig, purposeSign("x".repeat(64), "notice", `notice.v1.${body.ts}.${body.requestId}.${body.payloadSha256}`));
});

test("envelope endpoint: 401 without or with a wrong key, 404 unknown id, 200 returns the stored envelope byte for byte", async () => {
  const env = envOf();
  const r = await call(worker, env, jsonReq("/api/intake.php", bigWebsite));
  const rid = r.json.referenceId;
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}`, null))).status, 401);
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}`, "wrong"))).status, 401);
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}`, FETCH_KEY + "x"))).status, 401);
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-999999"))).status, 404);
  assert.equal((await call(worker, env, getEnv("requestId=not-an-id"))).status, 404);
  const ok = await call(worker, env, getEnv(`requestId=${rid}`));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get("Cache-Control"), "no-store");
  const stored = env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE request_id = ?").get(rid).envelope_json;
  assert.equal(ok.text, stored);
  const envl = JSON.parse(ok.text);
  assert.equal(envl.signature.hex, purposeSign(env.LEAD_HMAC_SECRET, "envelope", `envelope.v1.${envl.signature.ts}.${envl.payloadJson}`));
  assert.equal(envl.signature.over, 'envelope.v1. + ts + "." + payloadJson');
  assert.ok(!("leadBotId" in envl));
  const payload = JSON.parse(envl.payloadJson);
  assert.ok(!("email" in (payload.contact ?? {})), "contact.email stays in D1, not the envelope");
  assert.match(payload.contact.contactRef, /^[a-f0-9]{64}$/);
  assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok(ok.headers.get("Content-Security-Policy").includes("default-src 'self'"));
  assert.equal(createHash("sha256").update(envl.payloadJson).digest("hex"), calls[0].body.payloadSha256, "the notice hash matches the fetched payloadJson");
  assert.equal(JSON.parse(envl.payloadJson).requestDetails.website.mustHaveFeatures, "F".repeat(600), "nothing trimmed");
  assert.equal((await call(worker, env, new Request(`${ORIGIN}/api/envelope.php?requestId=${rid}`, { method: "POST", headers: { Authorization: `Bearer ${FETCH_KEY}` } }))).status, 405);
  // The key is never logged.
  assert.ok(!JSON.stringify(env.DB.raw.prepare("SELECT event_json FROM events").all()).includes(FETCH_KEY));
});

test("envelope endpoint: kind and payloadSha256 pick the right message when a request has several", async () => {
  const env = envOf();
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  const rid = r.json.referenceId;
  const msg = await call(worker, env, jsonReq("/api/status.php", { ref: rid, token: r.json.statusToken, message: "Any update?" }));
  assert.equal(msg.status, 200, msg.text);
  const [card, visitor] = calls.map((c) => c.body);
  assert.equal(card.kind, "intake-card"); assert.equal(visitor.kind, "visitor-message");
  assert.ok(Buffer.byteLength(calls[1].raw) < 2048, "visitor-message delivery is a notice too");
  const byKind = JSON.parse((await call(worker, env, getEnv(`requestId=${rid}&kind=intake-card`))).text);
  assert.equal(byKind.kind, "intake-card");
  const bySha = JSON.parse((await call(worker, env, getEnv(`requestId=${rid}&payloadSha256=${visitor.payloadSha256}`))).text);
  assert.equal(bySha.kind, "visitor-message"); assert.equal(JSON.parse(bySha.payloadJson).message, "Any update?");
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}&payloadSha256=${"0".repeat(64)}`))).status, 404);
});

test("envelope endpoint: envelopes expire after 24 h (query cutoff) and cleanup deletes them", async () => {
  const env = envOf();
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  const rid = r.json.referenceId;
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}`))).status, 200);
  const old = Math.floor(Date.now() / 1000) - W.ENVELOPE_TTL_SEC - 5;
  env.DB.raw.prepare("UPDATE outbox SET created_at = ?, updated_at = ? WHERE request_id = ?").run(old, old, rid);
  assert.equal((await call(worker, env, getEnv(`requestId=${rid}`))).status, 404, "older than 24 h is not served");
  env.DB.raw.prepare("UPDATE meta SET value = 0 WHERE key = 'last_cleanup'").run();
  const c = { env, cfg: W.appConfig(env), now: Math.floor(Date.now() / 1000), ip: "x", request: null };
  assert.equal(await W.intakeCleanup(c), true);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM outbox WHERE request_id = ?").get(rid).n, 0, "cleanup removed the expired sent envelope");
});

test("envelope endpoint: no LEAD_FETCH_KEY is a fixed 503; only failed auth is rate limited", async () => {
  const env0 = envOf({ LEAD_FETCH_KEY: "" });
  const missing = await call(worker, env0, getEnv("requestId=REQ-20261127-000001"));
  assert.equal(missing.status, 503);
  assert.equal(missing.json.message, W.PUBLIC_UNAVAILABLE_MESSAGE);
  assert.ok(!missing.text.includes("LEAD_FETCH_KEY"));
  const env = envOf({ ENVELOPE_RATE_LIMIT_MAX: "2" });
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-000001"))).status, 404);
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-000001"))).status, 404);
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-000001"))).status, 404, "a valid key is not locked out");
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-000001", "wrong-key"))).status, 401);
  assert.equal((await call(worker, env, getEnv("requestId=REQ-20261127-000001", "wrong-key"))).status, 401);
  const r = await call(worker, env, getEnv("requestId=REQ-20261127-000001", "wrong-key"));
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get("Retry-After")) > 0);
});
