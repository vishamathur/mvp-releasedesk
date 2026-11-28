// Signed outbox -> Lead webhook, retries without cron, and 30-day retention.
// The webhook receiver here is a local recorder that checks the HMAC; nothing leaves the process.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, getReq, call, count, blockNetwork, ER, testKey, isRepoHostUrl, liveRepoFetch, purposeSign } from "./helpers.mjs";

const HOOK = "https://lead-webhook.invalid/hook";
let restore;
beforeEach(() => { restore = blockNetwork(); });
afterEach(() => restore());

function recorder(status, calls) {
  return async (url, init) => {
    if (isRepoHostUrl(url)) return liveRepoFetch(url, init);
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
  // The webhook carries only a small signed notice; the full envelope is fetched from api/envelope.php.
  assert.deepEqual(Object.keys(body), ["source", "kind", "requestId", "ts", "payloadSha256", "sig"]);
  assert.equal(body.kind, "intake-card"); assert.equal(body.requestId, r.json.referenceId); assert.equal(body.source, "intake.vishalmathur.org");
  const stored = JSON.parse(env.DB.raw.prepare("SELECT envelope_json FROM outbox").get().envelope_json);
  assert.equal(body.payloadSha256, createHash("sha256").update(stored.payloadJson).digest("hex"));
  assert.equal(body.sig, purposeSign(env.LEAD_HMAC_SECRET, "notice", `notice.v1.${body.ts}.${body.requestId}.${body.payloadSha256}`));
  assert.equal(stored.signature.hex, purposeSign(env.LEAD_HMAC_SECRET, "envelope", `envelope.v1.${stored.signature.ts}.${stored.payloadJson}`));
  assert.ok(!("payload" in stored), "the payload travels once, as payloadJson");
  const payload = JSON.parse(stored.payloadJson);
  assert.equal(payload.humanGate, null); assert.equal(payload.finance.gate.decidedBy, null);
  const row = env.DB.raw.prepare("SELECT state, attempts FROM outbox").get();
  assert.deepEqual({ ...row }, { state: "sent", attempts: 1 });
});

test("payloadJson is printable ASCII with no short escapes, parses to the same card, and the HMAC covers it as sent", async () => {
  const card = { ask: { description: "Website creation: Acme\nPurpose: tabs\there\r\nquote \" backslash \\n literal \u00e9\u4e2d\u2028 \ud83d\ude00" } };
  const t = W.jsonAsciiSafe(card);
  assert.ok(/^[\x20-\x7e]*$/.test(t), "printable ASCII only");
  assert.ok(!/(^|[^\\])(\\\\)*\\[nrtbf]/.test(t), "no short escapes");
  assert.deepEqual(JSON.parse(t), card);
  assert.ok(t.includes("\\\\n literal"), "an escaped backslash before n stays a backslash and the letter n");
  const secret = testKey();
  const env = await W.deliveryEnvelope({ LEAD_HMAC_SECRET: secret }, "intake-card", "REQ-20261127-000001", card, 1795813322);
  assert.equal(env.payloadJson, t);
  assert.equal(env.signature.hex, purposeSign(secret, "envelope", `envelope.v1.${env.signature.ts}.${env.payloadJson}`));
  const env2 = await W.deliveryEnvelope({ LEAD_HMAC_SECRET: secret }, "intake-card", "REQ-20261127-000001", { d: "Line one\nLine two\r\nLine three" }, 1795813322);
  assert.ok(!JSON.stringify(env2).includes("\\\\n") && !env2.payloadJson.includes("\\n"), "a multi-line brief has no newline escape in payloadJson or the body");
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

test("N19: a catalogue read claims the purge at most once a minute", async () => {
  W.resetCatalogueCleanupMeter();
  const env = testEnv();
  let batches = 0;
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = async (stmts) => { batches += 1; return batch(stmts); };
  const first = await call(worker, env, getReq("/api/catalogue.php"));
  assert.equal(first.status, 200);
  const afterFirst = batches;
  assert.ok(afterFirst >= 1, "the first catalogue read claims the purge");
  const second = await call(worker, env, getReq("/api/catalogue.php"));
  assert.equal(second.status, 200);
  assert.equal(batches, afterFirst, "a second read inside the minute does not touch D1 for the purge");
  const now = Math.floor(Date.now() / 1000);
  assert.equal(W.catalogueCleanupDue(now), false);
  assert.equal(W.catalogueCleanupDue(now + W.CATALOGUE_CLEANUP_GAP_SEC), true);
  W.resetCatalogueCleanupMeter();
});

test("N17: a visitor message with a missing or short salt is a fixed 503 and adds no outbox row", async () => {
  for (const salt of ["", "x".repeat(21), "x".repeat(31)]) {
    const env = testEnv();
    const created = await call(worker, env, jsonReq("/api/intake.php", ER));
    assert.equal(created.status, 200, created.text);
    const before = count(env, "outbox");
    env.CONTACT_REF_SALT = salt;
    const msg = await call(worker, env, jsonReq("/api/status.php", { ref: created.json.referenceId, token: created.json.statusToken, message: "Any update?" }));
    assert.equal(msg.status, 503, salt || "empty");
    assert.equal(msg.json.error, "not_configured");
    assert.equal(msg.json.message, W.PUBLIC_UNAVAILABLE_MESSAGE);
    assert.equal(msg.text.includes("CONTACT_REF_SALT"), false);
    assert.equal(count(env, "outbox"), before);
    assert.equal(count(env, "submissions"), 1);
  }
});

test("N10: a missing or short CONTACT_REF_SALT stores no submission and no outbox", async () => {
  for (const salt of ["", "x".repeat(21), "x".repeat(31)]) {
    const env = testEnv({ CONTACT_REF_SALT: salt, LEAD_DELIVERY: "webhook", LEAD_WEBHOOK_URL: HOOK, LEAD_WEBHOOK_KEY: "routine-key-not-real" });
    const r = await call(worker, env, jsonReq("/api/intake.php", ER));
    assert.equal(r.status, 503, salt.length ? `len ${salt.length}` : "empty");
    assert.equal(r.json.error, "not_configured");
    assert.equal(r.json.message, W.PUBLIC_UNAVAILABLE_MESSAGE);
    assert.equal(r.text.includes("CONTACT_REF_SALT"), false);
    assert.equal(count(env, "submissions"), 0);
    assert.equal(count(env, "outbox"), 0);
    assert.equal(count(env, "status"), 0);
    await assert.rejects(() => W.deliverySend({ env, cfg: W.appConfig(env), now: Math.floor(Date.now() / 1000) }, "intake-card", "REQ-20261128-000001", { contact: { email: "jane@example.com", name: "Jane" } }));
    assert.equal(count(env, "outbox"), 0);
  }
});

test("retention: 24 h window removes every outbox state and logs dead rows", async () => {
  const env = testEnv({ RETENTION_DAYS: "1" });
  const now = Math.floor(Date.now() / 1000);
  const old = now - 2 * 86400, fresh = now - 3600;
  const ins = (table, sql, ...p) => env.DB.raw.prepare(`INSERT INTO ${table} ${sql}`).run(...p);
  for (const [rid, t] of [["REQ-20261001-000001", old], ["REQ-20261120-000002", fresh]]) {
    ins("submissions", "(request_id, pid, card_json, created_at) VALUES (?, 'PID-ER', '{}', ?)", rid, t);
    ins("finance_artifacts", "(request_id, assessment_json, created_at) VALUES (?, '{}', ?)", rid, t);
    ins("status", "(request_id, pid, token_hash, status, history_json, created_at, updated_at) VALUES (?, 'PID-ER', 'h', 'received', '[]', ?, ?)", rid, t, t);
    ins("outbox", "(id, request_id, kind, envelope_json, state, created_at, updated_at) VALUES (?, ?, 'intake-card', '{}', 'sent', ?, ?)", rid, rid, t, t);
    ins("events", "(at, event_json) VALUES (?, '{}')", t);
  }
  ins("outbox", "(id, request_id, kind, envelope_json, state, created_at, updated_at) VALUES ('q-old', 'REQ-20261001-000003', 'intake-card', '{}', 'queued', ?, ?)", old, old);
  ins("outbox", "(id, request_id, kind, envelope_json, state, created_at, updated_at) VALUES ('d-old', 'REQ-20261001-000004', 'intake-card', '{}', 'dead', ?, ?)", old, old);
  ins("rate_hits", "(bucket, ts) VALUES ('b', ?)", now - 8000);
  assert.equal(await W.intakeCleanup(ctxOf(env, now)), true);
  for (const t of ["submissions", "finance_artifacts", "status"]) assert.equal(count(env, t), 1, t);
  assert.equal(count(env, "events", "at = " + fresh), 1, "the fresh event stays");
  assert.equal(count(env, "outbox"), 1, "only the fresh envelope remains, in any state");
  assert.equal(count(env, "rate_hits"), 0);
  const ev = env.DB.raw.prepare("SELECT event_json FROM events").all().map((x) => JSON.parse(x.event_json));
  assert.ok(ev.some((e) => e.event === "outbox_dead_purged" && e.ids.includes("d-old")));
  assert.equal(await W.intakeCleanup(ctxOf(env, now + 60)), false, "hourly");
  assert.equal(await W.intakeCleanup(ctxOf(env, now + 3601)), true);
  const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
  await worker.scheduled({ cron: "17 * * * *" }, env, ctx);
  await Promise.all(ctx.pending);
});
