// Intake-inline path: grok-bots/tools/verify_intake.py (run by the Intake bot) and scripts/intake-inline-e2e.py
// (pre-cutover check) against the real worker over a loopback HTTP server. No Grok, no Cloudflare, no network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import worker from "../src/worker.mjs";
import { ORIGIN, testEnv, testCtx, ER, purposeSign } from "./helpers.mjs";

const run = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERIFY = join(REPO, "grok-bots", "tools", "verify_intake.py");
const E2E = join(REPO, "scripts", "intake-inline-e2e.py");
const FETCH_KEY = randomBytes(32).toString("hex");

let dir, inbox, env, site, sink, siteUrl, sinkUrl;

function adapt(handler) {
  return http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const out = await handler(req, Buffer.concat(chunks));
    res.writeHead(out.status, out.headers ?? {}); res.end(out.body);
  });
}
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "intake-inline-"));
  inbox = join(dir, "inbox");
  env = testEnv({ LEAD_FETCH_KEY: FETCH_KEY });
  site = adapt(async (req, body) => {
    const headers = { "CF-Connecting-IP": "203.0.113.7", Origin: ORIGIN };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    const r = new Request(ORIGIN + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const ctx = testCtx(); const res = await worker.fetch(r, env, ctx); await Promise.all(ctx.pending);
    return { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "text/plain" }, body: Buffer.from(await res.arrayBuffer()) };
  });
  siteUrl = await listen(site);
});
after(() => { site.close(); sink?.close(); rmSync(dir, { recursive: true, force: true }); });

const childEnv = (extra = {}) => {
  const e = {
    PATH: process.env.PATH,
    INTAKE_INBOX_DIR: inbox,
    INTAKE_BASE_URL: siteUrl,
    RELEASEDESK_INTAKE_HMAC_SECRET: env.LEAD_HMAC_SECRET,
    RELEASEDESK_INTAKE_FETCH_KEY: FETCH_KEY,
    ...extra,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
};
async function py(args, extra) {
  try { const r = await run("python3", args, { env: childEnv(extra), timeout: 60000 }); return { code: 0, json: JSON.parse(r.stdout.trim().split("\n").pop()), out: r.stdout }; }
  catch (e) { return { code: e.code, json: JSON.parse(String(e.stdout).trim().split("\n").pop() || "{}"), out: String(e.stdout) }; }
}


// Loopback client with a fixed host and the listening port only, so no caller-supplied URL is ever fetched.
function local(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: site.address().port, path, method, headers }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }); });
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}

async function submitCard(over = {}) {
  const r = await local("/api/intake.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ER, ...over }) });
  assert.equal(r.status, 200); return r.json().referenceId;
}
async function noticeFor(rid, { ts = String(Math.floor(Date.now() / 1000)), key = env.LEAD_HMAC_SECRET, sha } = {}) {
  const r = await local(`/api/envelope.php?requestId=${rid}&kind=intake-card`, { headers: { Authorization: "Bearer " + FETCH_KEY } });
  const e = r.json();
  const payloadSha256 = sha ?? createHash("sha256").update(e.payloadJson).digest("hex");
  return { env: e, args: [rid, ts, payloadSha256, purposeSign(key, "notice", `notice.v1.${ts}.${rid}.${payloadSha256}`), "intake-card"] };
}

test("verify_intake: real notice from the site verifies, saves 0600, and --file re-verifies", async () => {
  const rid = await submitCard();
  const { args } = await noticeFor(rid);
  const r = await py([VERIFY, ...args]);
  assert.equal(r.json.ok, true, r.out); assert.equal(r.json.noticeSig, true); assert.equal(r.json.envelopeSig, true); assert.equal(r.json.shaMatch, true);
  assert.equal(statSync(r.json.savedTo).mode & 0o777, 0o600);
  const again = await py([VERIFY, "--file", r.json.savedTo]);
  assert.equal(again.json.ok, true, again.out);
  assert.ok(!r.out.includes(env.LEAD_HMAC_SECRET) && !r.out.includes(FETCH_KEY), "no secret in output");
});

test("verify_intake: rejects a notice signed with a different secret (the INTAKE_HMAC_SECRET mismatch case)", async () => {
  const rid = await submitCard();
  const { args } = await noticeFor(rid, { key: randomBytes(32).toString("hex") });
  const r = await py([VERIFY, ...args]);
  assert.equal(r.json.noticeSig, false); assert.equal(r.json.ok, false); assert.equal(r.json.fetched, null);
});

test("verify_intake: missing secrets fail closed with missing_secret and never print values", async () => {
  const rid = "REQ-20261128-000001";
  const dummy = [VERIFY, rid, "1".repeat(10), "a".repeat(64), "b".repeat(64), "intake-card"];
  const unsetBoth = await py(dummy, { RELEASEDESK_INTAKE_HMAC_SECRET: undefined, RELEASEDESK_INTAKE_FETCH_KEY: undefined });
  assert.equal(unsetBoth.json.ok, false);
  assert.equal(unsetBoth.json.error, "missing_secret:RELEASEDESK_INTAKE_HMAC_SECRET");
  assert.equal(unsetBoth.code, 0);
  const unsetFetch = await py(dummy, { RELEASEDESK_INTAKE_FETCH_KEY: undefined });
  assert.equal(unsetFetch.json.ok, false);
  assert.equal(unsetFetch.json.error, "missing_secret:RELEASEDESK_INTAKE_FETCH_KEY");
  const emptyHmac = await py(dummy, { RELEASEDESK_INTAKE_HMAC_SECRET: "" });
  assert.equal(emptyHmac.json.ok, false);
  assert.equal(emptyHmac.json.error, "missing_secret:RELEASEDESK_INTAKE_HMAC_SECRET");
  const missingFile = await py([VERIFY, "--file", join(inbox, "REQ-20261128-000001-1.json")], { RELEASEDESK_INTAKE_HMAC_SECRET: undefined });
  assert.equal(missingFile.json.ok, false);
  assert.equal(missingFile.json.error, "missing_secret:RELEASEDESK_INTAKE_HMAC_SECRET");
});

test("verify_intake: stale ts, wrong sha, bad ids, bad base url, wrong fetch key and tampered file all fail", async () => {
  const rid = await submitCard();
  const old = String(Math.floor(Date.now() / 1000) - 700);
  const stale = await py([VERIFY, ...(await noticeFor(rid, { ts: old })).args]);
  assert.equal(stale.json.noticeSig, true); assert.equal(stale.json.fresh, false); assert.equal(stale.json.ok, false);
  const badSha = await py([VERIFY, ...(await noticeFor(rid, { sha: "0".repeat(64) })).args]);
  assert.equal(badSha.json.ok, false); assert.equal(badSha.json.fetched, 404, "the site has no message with that hash");
  assert.equal((await py([VERIFY, "REQ-1", "1", "x", "y"])).json.ok, false);
  const { args } = await noticeFor(rid);
  assert.equal((await py([VERIFY, ...args], { INTAKE_BASE_URL: "https://evil.example" })).json.error, "bad base url");
  const wf = await py([VERIFY, ...args], { RELEASEDESK_INTAKE_FETCH_KEY: randomBytes(32).toString("hex") });
  assert.equal(wf.json.fetched, 401); assert.equal(wf.json.ok, false);
  const good = await py([VERIFY, ...args]);
  const t = JSON.parse(readFileSync(good.json.savedTo, "utf8")); t.payloadJson = t.payloadJson.replace("Rename", "Rename!");
  const tampered = join(inbox, `REQ-20261128-000001-1.json`); writeFileSync(tampered, JSON.stringify(t));
  assert.equal((await py([VERIFY, "--file", tampered])).json.ok, false);
  assert.equal((await py([VERIFY, "--file", join(dir, "outside.json")])).json.error, "path is not an inbox file");
});

function startSink(secretEnv = {}) {
  // Stands in for Intake's webhook routine: it runs the same verifier the Intake bot runs, with the secrets it was given.
  sink = adapt(async (req, body) => {
    const auth = req.headers.authorization === "Bearer sink-key-for-test";
    if (!auth) return { status: 401, body: "no" };
    const n = JSON.parse(body.toString());
    execFile("python3", [VERIFY, n.requestId, n.ts, n.payloadSha256, n.sig, n.kind], { env: childEnv(secretEnv) }, () => {});
    return { status: 202, body: "{}" };
  });
  return listen(sink);
}
const webhookEnv = (url) => ({ INTAKE_WEBHOOK_URL: url, INTAKE_WEBHOOK_KEY: "sink-key-for-test", INTAKE_WEBHOOK_AUTH: "bearer" });

test("e2e script: PASS end to end when Intake holds the site's secret; no secret in its output", async () => {
  sinkUrl = await startSink();
  const r = await py([E2E, "--wait", "30"], webhookEnv(sinkUrl));
  assert.equal(r.code, 0, r.out); assert.equal(r.json.result, "PASS");
  assert.deepEqual(r.json.steps.map((s) => s.step), ["preflight", "submit", "envelope", "card-is-probe", "notice", "webhook", "inbox-file", "inbox-envelope-hmac"]);
  assert.ok(!r.out.includes(env.LEAD_HMAC_SECRET) && !r.out.includes(FETCH_KEY) && !r.out.includes("sink-key-for-test"));
  const card = JSON.parse(env.DB.raw.prepare("SELECT envelope_json FROM outbox ORDER BY created_at DESC, rowid DESC LIMIT 1").get().envelope_json);
  const payload = JSON.parse(card.payloadJson);
  assert.match(payload.ask.title, /^PROBE-E2E /);
  assert.equal(payload.repository.repo, "octocat/Hello-World");
  assert.equal(payload.repository.verification.state, "verified");
  sink.close();
});

test("verify_intake: millisecond ts is rejected, a kind mismatch does not save, and a replay is a duplicate", async () => {
  const rid = await submitCard();
  const ms = await py([VERIFY, rid, "1700000000000", "ab".repeat(32), "cd".repeat(32), "intake-card"]);
  assert.equal(ms.json.ok, false);
  assert.equal(ms.json.error, "bad notice fields");
  const { args } = await noticeFor(rid);
  const first = await py([VERIFY, ...args]);
  assert.equal(first.json.ok, true, first.out);
  const bound = await py(["-c", `import json, importlib.util\nspec = importlib.util.spec_from_file_location("verify_intake", ${JSON.stringify(VERIFY)})\nmod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\nbody = open(${JSON.stringify(first.json.savedTo)}, "rb").read()\nfields = mod.envelope_fields(body, mod.read_secret("RELEASEDESK_INTAKE_HMAC_SECRET"), ${JSON.stringify(rid)}, ${JSON.stringify(args[2])}, "visitor-message")\nprint(json.dumps(fields))\n`]);
  assert.equal(bound.json.bound, false);
  assert.equal(bound.json.error, "payload binding");
  const jsons = () => readdirSync(inbox).filter((name) => name.endsWith(".json"));
  const before = jsons().length;
  const again = await py([VERIFY, ...args]);
  assert.equal(again.json.ok, false);
  assert.equal(again.json.error, "duplicate");
  assert.equal(jsons().length, before);
});

test("e2e script: FAIL when Intake holds a different secret (nothing is saved), and --dry-run posts nothing", async () => {
  sinkUrl = await startSink({ RELEASEDESK_INTAKE_HMAC_SECRET: randomBytes(32).toString("hex") });
  const before = readdirSync(inbox).length;
  const r = await py([E2E, "--wait", "4"], webhookEnv(sinkUrl));
  assert.equal(r.code, 1); assert.equal(r.json.result, "FAIL");
  assert.equal(r.json.steps.at(-1).step, "inbox-file"); assert.equal(r.json.steps.at(-1).pass, false);
  assert.equal(readdirSync(inbox).length, before);
  sink.close();
  const n = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM outbox").get().n;
  const d = await py([E2E, "--dry-run"], webhookEnv("https://example.invalid/hook"));
  assert.equal(d.json.result, "PASS"); assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM outbox").get().n, n);
});
