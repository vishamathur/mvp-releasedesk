// Signed outbox -> Lead webhook, retries without cron, and 30-day retention.
// The webhook receiver here is a local recorder that checks the HMAC; nothing leaves the process.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, call, count, blockNetwork, ER, testKey, isRepoHostUrl, liveRepoFetch } from "./helpers.mjs";

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
  assert.equal(body.sig, createHmac("sha256", env.LEAD_HMAC_SECRET).update(`${body.ts}.${body.requestId}.${body.payloadSha256}`).digest("hex"));
  assert.equal(stored.signature.hex, createHmac("sha256", env.LEAD_HMAC_SECRET).update(`${stored.signature.ts}.${stored.payloadJson}`).digest("hex"));
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
  assert.equal(env.signature.hex, createHmac("sha256", secret).update(`${env.signature.ts}.${env.payloadJson}`).digest("hex"));
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
