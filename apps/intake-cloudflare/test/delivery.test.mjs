// Signed outbox -> Lead webhook, retries without cron, and 30-day retention.
// The webhook receiver here is a local recorder that checks the HMAC; nothing leaves the process.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, call, count, blockNetwork, ER } from "./helpers.mjs";

const HOOK = "https://lead-webhook.invalid/hook";
let restore;
beforeEach(() => { restore = blockNetwork(); });
afterEach(() => restore());

function recorder(status, calls) {
  return async (url, init) => {
    if (url !== HOOK) throw new Error("unexpected url " + url);
    calls.push({ url, headers: init.headers, raw: init.body, body: JSON.parse(init.body), hasTimeout: init.signal instanceof AbortSignal });
    return new Response("{}", { status });
  };
}
const webhookEnv = (extra = {}) => testEnv({ LEAD_DELIVERY: "webhook", LEAD_WEBHOOK_URL: HOOK, LEAD_WEBHOOK_KEY: "routine-key-not-real", ...extra });
const ctxOf = (env, now) => ({ env, cfg: W.appConfig(env), now, ip: "x", request: null });

test("webhook delivery: bearer auth, signed envelope, outbox marked sent", async () => {
  const calls = [];
  globalThis.fetch = recorder(202, calls);
  const env = webhookEnv();
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(r.status, 200, r.text);
  assert.equal(calls.length, 1);
  const { headers, body, hasTimeout } = calls[0];
  assert.equal(headers.Authorization, "Bearer routine-key-not-real"); assert.ok(hasTimeout);
  assert.equal(body.kind, "intake-card"); assert.equal(body.requestId, r.json.referenceId); assert.equal(body.untrusted, true);
  assert.equal(body.leadBotId, "46e50097-0409-4972-9be0-6ade37563135");
  assert.equal(body.signature.alg, "HMAC-SHA256"); assert.equal(body.signature.over, 'ts + "." + payloadJson');
  assert.equal(body.signature.hex, createHmac("sha256", env.LEAD_HMAC_SECRET).update(`${body.signature.ts}.${body.payloadJson}`).digest("hex"));
  assert.ok(!("payload" in body), "the payload travels once, as payloadJson");
  const payload = JSON.parse(body.payloadJson);
  assert.equal(payload.humanGate, null); assert.equal(payload.finance.gate.decidedBy, null);
  assert.ok(!("deliveryTrimmed" in payload), "a normal ER card is not trimmed");
  const row = env.DB.raw.prepare("SELECT state, attempts FROM outbox").get();
  assert.deepEqual({ ...row }, { state: "sent", attempts: 1 });
});

test("large PID-NC website envelope stays under the webhook byte limit, keeps its signature first, and verifies", async () => {
  const calls = [];
  globalThis.fetch = recorder(202, calls);
  const env = webhookEnv();
  const big = { route: "website", pid: "PID-NC", catalogueOptionId: "NC-WEBSITE", addOns: ["ADD-NC-WEB-SITE", "ADD-NC-WEB-FORMS", "ADD-NC-WEB-AI"],
    contactName: "Jane \"Quote\" Doe", email: "jane@example.com", company: "Acme & Sons <Holdings>", legalName: "Acme Pvt Ltd", jurisdiction: "India", sponsor: "R. Rao, CFO",
    siteName: "Acme Lending", purpose: "P\"".repeat(300), audience: "A".repeat(300), pages: "Home, \"Products\", ".repeat(30).slice(0, 600),
    mustHaveFeatures: "F\\".repeat(300), brandAssets: "B".repeat(400), domainHosting: "D".repeat(300), budgetBand: "300k_plus", desiredBy: "2027-01-31",
    title: "T".repeat(150), description: "Notes \u00e9\u4e2d\"".repeat(500).slice(0, 4000), urgency: "critical", artifactLinks: [], website: "", consent: true };
  const r = await call(worker, env, jsonReq("/api/intake.php", big));
  assert.equal(r.status, 200, r.text);
  const raw = calls[0].raw;
  assert.ok(Buffer.byteLength(raw, "utf8") <= W.DELIVERY_MAX_BYTES_DEFAULT, `envelope ${Buffer.byteLength(raw, "utf8")} bytes`);
  assert.ok(raw.indexOf('"signature"') < raw.indexOf('"payloadJson"'), "signature precedes payloadJson");
  const body = JSON.parse(raw);
  assert.equal(body.signature.hex, createHmac("sha256", env.LEAD_HMAC_SECRET).update(`${body.signature.ts}.${body.payloadJson}`).digest("hex"));
  const sent = JSON.parse(body.payloadJson);
  assert.equal(sent.requestType, "website-creation"); assert.equal(sent.pid, "PID-NC");
  assert.ok(Array.isArray(sent.deliveryTrimmed) && sent.deliveryTrimmed.length >= 1, JSON.stringify(sent.deliveryTrimmed));
  assert.equal(sent.ask.notes, null);
  assert.ok(sent.ask.description.includes("trimmed for delivery"));
  // The stored card is complete; only the delivered copy is trimmed.
  const stored = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.ok(!("deliveryTrimmed" in stored)); assert.equal(stored.ask.notes, stored.ask.description); assert.ok(!stored.ask.description.includes("trimmed for delivery"));
  assert.equal(JSON.parse(env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE request_id = ?").get(r.json.referenceId).envelope_json).payloadJson, body.payloadJson);
});

test("deliveryFit: a small payload is untouched; a tiny LEAD_WEBHOOK_MAX_BYTES that cannot fit is a real error", async () => {
  const cfg = { LEAD_HMAC_SECRET: "k".repeat(64) };
  const [env, trimmed] = await W.deliveryFit(cfg, "visitor-message", "REQ-20261127-000001", { message: "hi" }, 1795813322);
  assert.deepEqual(trimmed, []); assert.deepEqual(JSON.parse(env.payloadJson), { message: "hi" });
  assert.equal(W.deliveryMaxBytes({ LEAD_WEBHOOK_MAX_BYTES: "50" }), W.DELIVERY_MAX_BYTES_DEFAULT, "out-of-range override falls back");
  await assert.rejects(W.deliveryFit({ ...cfg, LEAD_WEBHOOK_MAX_BYTES: 2000 }, "visitor-message", "REQ-20261127-000001", { message: "x".repeat(3000) }, 1795813322), /Refusing to send/);
});

test("webhook delivery: header:<Name> auth style", async () => {
  const calls = [];
  globalThis.fetch = recorder(200, calls);
  const env = webhookEnv({ LEAD_WEBHOOK_AUTH: "header:X-Routine-Key" });
  assert.equal((await call(worker, env, jsonReq("/api/intake.php", ER))).status, 200);
  assert.equal(calls[0].headers["X-Routine-Key"], "routine-key-not-real"); assert.ok(!("Authorization" in calls[0].headers));
});

test("webhook failure is a real error, the card is kept, and a later drain retries it", async () => {
  const calls = [];
  globalThis.fetch = recorder(500, calls);
  const env = webhookEnv();
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(r.status, 500); assert.equal(r.json.error, "server_error");
  assert.equal(count(env, "submissions"), 1);
  let row = env.DB.raw.prepare("SELECT id, state, attempts, last_error FROM outbox").get();
  assert.equal(row.state, "queued"); assert.equal(row.attempts, 1); assert.equal(row.last_error, "webhook_500");
  const ev = env.DB.raw.prepare("SELECT event_json FROM events").all().map((x) => JSON.parse(x.event_json));
  assert.ok(ev.some((e) => e.event === "unhandled" && e.reason.includes("Lead delivery failed (webhook_500)")));
  // Too soon: the 5-minute drain marker was claimed by the request above, so nothing happens.
  const now = Math.floor(Date.now() / 1000);
  assert.deepEqual(await W.drainOutbox(ctxOf(env, now + 10)), []);
  globalThis.fetch = recorder(200, calls);
  const done = await W.drainOutbox(ctxOf(env, now + 400));
  assert.deepEqual(done, [[row.id, "webhook_200"]]);
  row = env.DB.raw.prepare("SELECT state, attempts FROM outbox").get();
  assert.deepEqual({ ...row }, { state: "sent", attempts: 2 });
});

test("webhook not configured is a real error, not a silent queue", async () => {
  const env = testEnv({ LEAD_DELIVERY: "webhook" });
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(r.status, 500);
  assert.equal(env.DB.raw.prepare("SELECT last_error FROM outbox").get().last_error, "webhook_not_configured");
});

test("drain moves a message to dead after 50 attempts", async () => {
  const env = webhookEnv();
  const now = Math.floor(Date.now() / 1000);
  env.DB.raw.prepare("INSERT INTO outbox (id, request_id, kind, envelope_json, attempts, state, created_at, updated_at) VALUES ('m1', 'REQ-20261122-000001', 'intake-card', '{}', 50, 'queued', ?, ?)").run(now - 1000, now - 1000);
  assert.deepEqual(await W.drainOutbox(ctxOf(env, now)), []);
  assert.equal(env.DB.raw.prepare("SELECT state FROM outbox WHERE id = 'm1'").get().state, "dead");
});

test("retention: rows older than RETENTION_DAYS are removed at most once an hour", async () => {
  const env = testEnv();
  const now = Math.floor(Date.now() / 1000);
  const old = now - 31 * 86400, fresh = now - 86400;
  const ins = (table, sql, ...p) => env.DB.raw.prepare(`INSERT INTO ${table} ${sql}`).run(...p);
  for (const [rid, t] of [["REQ-20261001-000001", old], ["REQ-20261120-000002", fresh]]) {
    ins("submissions", "(request_id, pid, card_json, created_at) VALUES (?, 'PID-ER', '{}', ?)", rid, t);
    ins("finance_artifacts", "(request_id, assessment_json, created_at) VALUES (?, '{}', ?)", rid, t);
    ins("status", "(request_id, pid, token_hash, status, history_json, created_at, updated_at) VALUES (?, 'PID-ER', 'h', 'received', '[]', ?, ?)", rid, t, t);
    ins("outbox", "(id, request_id, kind, envelope_json, state, created_at, updated_at) VALUES (?, ?, 'intake-card', '{}', 'sent', ?, ?)", rid, rid, t, t);
    ins("events", "(at, event_json) VALUES (?, '{}')", t);
  }
  ins("outbox", "(id, request_id, kind, envelope_json, state, created_at, updated_at) VALUES ('q-old', 'REQ-20261001-000003', 'intake-card', '{}', 'queued', ?, ?)", old, old);
  ins("rate_hits", "(bucket, ts) VALUES ('b', ?)", now - 8000);
  assert.equal(await W.intakeCleanup(ctxOf(env, now)), true);
  for (const t of ["submissions", "finance_artifacts", "status", "events"]) assert.equal(count(env, t), 1, t);
  assert.equal(count(env, "outbox", "state = 'sent'"), 1);
  assert.equal(count(env, "outbox", "state = 'queued'"), 1, "undelivered messages are kept, as in the PHP");
  assert.equal(count(env, "rate_hits"), 0);
  assert.equal(await W.intakeCleanup(ctxOf(env, now + 60)), false, "hourly");
  assert.equal(await W.intakeCleanup(ctxOf(env, now + 3601)), true);
});
