// INTAKE_SUBMISSIONS_PAUSED: submit endpoints return 503, store nothing and never call LEAD_WEBHOOK_URL.
// Catalogue, status reads and envelope fetch stay available. No network, no Cloudflare account.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, getReq, call, count, blockNetwork, ER, ORIGIN } from "./helpers.mjs";

const HOOK = "https://lead-webhook.invalid/hook";
const FETCH_KEY = "f".repeat(64);
const PAUSED = { INTAKE_SUBMISSIONS_PAUSED: "1" };
const MSG = "New requests are paused for a short upgrade. Please check back soon.";

let restore, hookCalls;
beforeEach(() => {
  hookCalls = [];
  restore = blockNetwork();
  globalThis.fetch = async (url, init) => {
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

test("paused: visitor-message POST is 503, stores nothing and does not call the webhook; GET status still works", async () => {
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

  const get = await call(worker, env, getReq(`/api/status.php?ref=${rid}&token=${token}`));
  assert.equal(get.status, 200);
  assert.equal(get.json.ok, true);
  assert.equal(get.json.requestId, rid);
  assert.equal(get.json.status, "received");
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
  const r = await call(worker, env, getReq(`/api/status.php?ref=${created.json.referenceId}&token=${created.json.statusToken}`));
  assert.equal(r.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT state FROM outbox WHERE request_id = ?").get(created.json.referenceId).state, "queued");
  assert.equal(hookCalls.length, 0);
});
