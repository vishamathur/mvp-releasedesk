// INTAKE_SUBMISSIONS_PAUSED: submit endpoints return 503, store nothing and never call LEAD_WEBHOOK_URL.
// Catalogue, status reads and envelope fetch stay available. No network, no Cloudflare account.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, getReq, call, count, blockNetwork, ER, ORIGIN, testKey, isRepoHostUrl, liveRepoFetch } from "./helpers.mjs";

const HOOK = "https://lead-webhook.invalid/hook";
const FETCH_KEY = "f".repeat(64);
const PAUSED = { INTAKE_SUBMISSIONS_PAUSED: "1" };
const MSG = "New requests are paused for a short upgrade. Please check back soon.";

let restore, hookCalls;
beforeEach(() => {
  hookCalls = [];
  restore = blockNetwork();
  globalThis.fetch = async (url, init) => {
    if (isRepoHostUrl(url)) return liveRepoFetch(url, init);
    if (url !== HOOK) throw new Error("unexpected url " + url);
    hookCalls.push(init?.body ?? "");
    return new Response("{}", { status: 202 });
  };
});
afterEach(() => restore());

const webhookEnv = (extra = {}) => testEnv({
  LEAD_DELIVERY: "webhook", LEAD_WEBHOOK_URL: HOOK, LEAD_WEBHOOK_KEY: "routine-key-not-real",
  LEAD_FETCH_KEY: FETCH_KEY, ...extra,
});

test("submissionsPaused: 1/true/yes/on (any case, trimmed) are on; anything else is off", () => {
  for (const v of ["1", "true", "TRUE", "Yes", " on ", "ON"]) assert.equal(W.submissionsPaused({ INTAKE_SUBMISSIONS_PAUSED: v }), true, v);
  for (const v of ["", "0", "false", "no", "off", "maybe", undefined]) assert.equal(W.submissionsPaused({ INTAKE_SUBMISSIONS_PAUSED: v }), false, String(v));
  assert.equal(W.submissionsPaused({}), false);
});

test("paused: POST intake.php is 503 submissions_paused, stores nothing and does not call the Lead webhook", async () => {
  const env = webhookEnv(PAUSED);
  const beforeSub = count(env, "submissions");
  const beforeOut = count(env, "outbox");
  const r = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, "submissions_paused");
  assert.equal(r.json.message, MSG);
  assert.equal(count(env, "submissions"), beforeSub);
  assert.equal(count(env, "outbox"), beforeOut);
  assert.equal(hookCalls.length, 0);
  // Honeypot field would normally look like a success; it still returns the pause.
  const honey = await call(worker, env, jsonReq("/api/intake.php", { ...ER, website: "https://spam.example" }));
  assert.equal(honey.status, 503);
  assert.equal(honey.json.error, "submissions_paused");
  assert.equal(count(env, "submissions"), beforeSub);
  assert.equal(hookCalls.length, 0);
});

test("paused: visitor-message POST is 503, stores nothing and does not call the webhook; a POST status read still works", async () => {
  const env = webhookEnv();
  const created = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(created.status, 200, created.text);
  const rid = created.json.referenceId;
  const token = created.json.statusToken;
  hookCalls.length = 0;

  env.INTAKE_SUBMISSIONS_PAUSED = "1";
  const beforeOut = count(env, "outbox");
  const post = await call(worker, env, jsonReq("/api/status.php", { ref: rid, token, message: "Any update?" }));
  assert.equal(post.status, 503);
  assert.equal(post.json.error, "submissions_paused");
  assert.equal(count(env, "outbox"), beforeOut);
  assert.equal(hookCalls.length, 0);

  const read = await call(worker, env, jsonReq("/api/status.php", { ref: rid, token }));
  assert.equal(read.status, 200);
  assert.equal(read.json.ok, true);
  assert.equal(read.json.requestId, rid);
  assert.equal(read.json.status, "received");
  const get = await call(worker, env, getReq(`/api/status.php?ref=${rid}&token=${token}`));
  assert.equal(get.status, 405);
});

test("paused: catalogue stays viewable with the flag, and the envelope endpoint still serves existing envelopes", async () => {
  const env = webhookEnv();
  const created = await call(worker, env, jsonReq("/api/intake.php", ER));
  const rid = created.json.referenceId;
  hookCalls.length = 0;
  env.INTAKE_SUBMISSIONS_PAUSED = "true";

  const cat = await call(worker, env, getReq("/api/catalogue.php"));
  assert.equal(cat.status, 200);
  assert.equal(cat.json.ok, true);
  assert.equal(cat.json.submissionsPaused, true);
  assert.ok(cat.json.services.length > 0);
  assert.equal(cat.headers.get("Cache-Control"), "no-store");
  assert.equal(hookCalls.length, 0, "catalogue must not drain the outbox when paused");

  const open = await call(worker, testEnv(), getReq("/api/catalogue.php"));
  assert.equal(open.json.submissionsPaused, false);
  assert.equal(open.headers.get("Cache-Control"), "public, max-age=300");

  const noKey = await call(worker, env, new Request(`${ORIGIN}/api/envelope.php?requestId=${rid}`));
  assert.equal(noKey.status, 401);
  const ok = await call(worker, env, new Request(`${ORIGIN}/api/envelope.php?requestId=${rid}`, { headers: { Authorization: `Bearer ${FETCH_KEY}` } }));
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.text).requestId, rid);
  assert.equal(hookCalls.length, 0);
});

test("paused: a queued outbox item is not retried (LEAD_WEBHOOK_URL is never called)", async () => {
  const env = webhookEnv({ LEAD_DELIVERY: "queue" });
  const created = await call(worker, env, jsonReq("/api/intake.php", ER));
  assert.equal(created.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT state FROM outbox WHERE request_id = ?").get(created.json.referenceId).state, "queued");
  env.LEAD_DELIVERY = "webhook";
  env.INTAKE_SUBMISSIONS_PAUSED = "1";
  const r = await call(worker, env, jsonReq("/api/status.php", { ref: created.json.referenceId, token: created.json.statusToken }));
  assert.equal(r.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT state FROM outbox WHERE request_id = ?").get(created.json.referenceId).state, "queued");
  assert.equal(hookCalls.length, 0);
});

test("paused: chat still applies the per-IP limit, daily cap and markup filter, and cleanup still keeps the daily bucket", async () => {
  const now = Math.floor(Date.now() / 1000);
  const retention = testEnv(PAUSED);
  const daily = await W.sha256Hex(W.CHAT_DAILY_RATE_KEY);
  const ins = retention.DB.raw.prepare("INSERT INTO rate_hits (bucket, ts) VALUES (?, ?)");
  ins.run(daily, now - 3 * 3600);
  ins.run(daily, now - 25 * 3600);
  ins.run("other", now - 3 * 3600);
  ins.run("fresh", now - 60);
  const sweep = await call(worker, retention, jsonReq("/api/status.php", { ref: "REQ-none", token: "ab".repeat(16) }));
  assert.equal(sweep.status, 404);
  assert.equal(retention.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ?").get(daily).n, 1, "N2: a 3 h daily hit stays while paused");
  assert.equal(retention.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = 'other'").get().n, 0);
  assert.equal(retention.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = 'fresh'").get().n, 1);

  const limited = testEnv({ ...PAUSED, CHAT_RATE_LIMIT_MAX: "1", CHAT_DAILY_MAX: "2" });
  const body = { route: "er", messages: [{ role: "user", content: "Hello there" }] };
  const ipA = { "CF-Connecting-IP": "198.51.100.10" };
  const ipB = { "CF-Connecting-IP": "198.51.100.20" };
  assert.equal((await call(worker, limited, jsonReq("/api/chat.php", body, ipA))).status, 503);
  for (let i = 0; i < 5; i++) {
    const blocked = await call(worker, limited, jsonReq("/api/chat.php", body, ipA));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error, "rate_limited");
  }
  const other = await call(worker, limited, jsonReq("/api/chat.php", body, ipB));
  assert.equal(other.status, 503);
  assert.notEqual(other.json.error, "assistant_busy");
  const dailyKey = await W.sha256Hex(W.CHAT_DAILY_RATE_KEY);
  assert.equal(limited.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ?").get(dailyKey).n, 2, "N1: the paused intake path does not replace the chat cap");
  const pausedIntake = await call(worker, limited, jsonReq("/api/intake.php", ER, ipA));
  assert.equal(pausedIntake.status, 503);
  assert.equal(pausedIntake.json.error, "submissions_paused");
  assert.equal(limited.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ?").get(dailyKey).n, 2, "a paused intake does not charge the chat cap");

  const chat = testEnv({ ...PAUSED, GROK_CHAT_API_KEY: testKey() });
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    reply: "See https://evil.example/a and <b>this</b>",
    route: "er",
    draft: { ...Object.fromEntries(W.CHAT_DRAFT_FIELDS.map((f) => [f, null])), purpose: "Read [notes](evil.com/x)", audience: "evil.com/x", contactName: "Jane Doe" },
    missingFields: [], readyToSubmit: false, suggestedServiceIds: [], suspectedPromptInjection: false,
  }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const reply = await call(worker, chat, jsonReq("/api/chat.php", { route: "er", messages: [{ role: "user", content: "Please fill the form" }] }));
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.json.draft.contactName, "Jane Doe");
  assert.ok(!("purpose" in reply.json.draft), "N8: markdown links are still dropped while paused");
  assert.ok(!("audience" in reply.json.draft), "N8: bare domains are still dropped while paused");
  assert.ok(!reply.json.reply.includes("https://"));
  assert.ok(!reply.json.reply.includes("<b>"));
});

test("paused: POST repo-check.php is 503 submissions_paused and does not call the code host", async () => {
  const env = webhookEnv(PAUSED);
  const r = await call(worker, env, jsonReq("/api/repo-check.php", { repoHost: "github", repo: "octocat/Hello-World" }));
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "submissions_paused");
  assert.equal(r.json.message, MSG);
  assert.equal(hookCalls.length, 0);
});
