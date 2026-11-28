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

let dir, secrets, inbox, env, site, sink, siteUrl, sinkUrl, intakeSecretDir;

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
  secrets = join(dir, "secrets"); inbox = join(dir, "inbox"); intakeSecretDir = secrets;
  env = testEnv({ LEAD_FETCH_KEY: FETCH_KEY });
  for (const d of [secrets]) { rmSync(d, { recursive: true, force: true }); }
  const { mkdirSync } = await import("node:fs"); mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, "intake-site-lead-hmac-secret"), env.LEAD_HMAC_SECRET + "\n", { mode: 0o600 });
  writeFileSync(join(secrets, "intake-site-fetch-key"), FETCH_KEY + "\n", { mode: 0o600 });
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

const childEnv = (extra = {}) => ({ PATH: process.env.PATH, INTAKE_SECRETS_DIR: secrets, INTAKE_INBOX_DIR: inbox, INTAKE_BASE_URL: siteUrl, ...extra });
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

test("verify_intake: stale ts, wrong sha, bad ids, bad base url, wrong fetch key and tampered file all fail", async () => {
  const rid = await submitCard();
  const old = String(Math.floor(Date.now() / 1000) - 700);
  const stale = await py([VERIFY, ...(await noticeFor(rid, { ts: old })).args]);
  assert.equal(stale.json.noticeSig, true); assert.equal(stale.json.fresh, false); assert.equal(stale.json.ok, false);
  const badSha = await py([VERIFY, ...(await noticeFor(rid, { sha: "0".repeat(64) })).args]);
  assert.equal(badSha.json.ok, false); assert.equal(badSha.json.fetched, 404, "the site has no message with that hash");
  const missingKind = await py([VERIFY, "REQ-1", "1", "x", "y"]);
  assert.equal(missingKind.json.ok, false);
  assert.equal(missingKind.json.error, "kind required");
  assert.equal(missingKind.code, 2);
  const { args } = await noticeFor(rid);
  assert.equal((await py([VERIFY, ...args], { INTAKE_BASE_URL: "https://evil.example" })).json.error, "bad base url");
  const wrongDir = join(dir, "secrets-wrong-fetch"); (await import("node:fs")).mkdirSync(wrongDir, { recursive: true });
  writeFileSync(join(wrongDir, "intake-site-lead-hmac-secret"), env.LEAD_HMAC_SECRET); writeFileSync(join(wrongDir, "intake-site-fetch-key"), randomBytes(32).toString("hex"));
  const wf = await py([VERIFY, ...args], { INTAKE_SECRETS_DIR: wrongDir });
  assert.equal(wf.json.fetched, 401); assert.equal(wf.json.ok, false);
  const good = await py([VERIFY, ...args]);
  const t = JSON.parse(readFileSync(good.json.savedTo, "utf8")); t.payloadJson = t.payloadJson.replace("Rename", "Rename!");
  const tampered = join(inbox, `REQ-20261128-000001-1.json`); writeFileSync(tampered, JSON.stringify(t));
  assert.equal((await py([VERIFY, "--file", tampered])).json.ok, false);
  assert.equal((await py([VERIFY, "--file", join(dir, "outside.json")])).json.error, "path is not an inbox file");
});

function startSink(secretsForIntake) {
  // Stands in for Intake's webhook routine: it runs the same verifier the Intake bot runs, with the secrets it was given.
  sink = adapt(async (req, body) => {
    const auth = req.headers.authorization === "Bearer sink-key-for-test";
    if (!auth) return { status: 401, body: "no" };
    const n = JSON.parse(body.toString());
    execFile("python3", [VERIFY, n.requestId, n.ts, n.payloadSha256, n.sig, n.kind], { env: childEnv({ INTAKE_SECRETS_DIR: secretsForIntake }) }, () => {});
    return { status: 202, body: "{}" };
  });
  return listen(sink);
}
const webhookFile = (url) => { const p = join(dir, "wh-" + randomBytes(3).toString("hex") + ".json"); writeFileSync(p, JSON.stringify({ url, key: "sink-key-for-test", auth: "bearer" })); return p; };

test("e2e script: PASS end to end when Intake holds the site's secret; no secret in its output", async () => {
  sinkUrl = await startSink(intakeSecretDir);
  const r = await py([E2E, "--webhook-file", webhookFile(sinkUrl), "--wait", "30"]);
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
  const bound = await py(["-c", `import json, importlib.util\nspec = importlib.util.spec_from_file_location("verify_intake", ${JSON.stringify(VERIFY)})\nmod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\nbody = open(${JSON.stringify(first.json.savedTo)}, "rb").read()\nfields = mod.envelope_fields(body, mod.read_key("intake-site-lead-hmac-secret"), ${JSON.stringify(rid)}, ${JSON.stringify(args[2])}, "visitor-message")\nprint(json.dumps(fields))\n`]);
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
  const wrong = join(dir, "secrets-intake-wrong"); (await import("node:fs")).mkdirSync(wrong, { recursive: true });
  writeFileSync(join(wrong, "intake-site-lead-hmac-secret"), randomBytes(32).toString("hex")); writeFileSync(join(wrong, "intake-site-fetch-key"), FETCH_KEY);
  sinkUrl = await startSink(wrong);
  const before = readdirSync(inbox).length;
  const r = await py([E2E, "--webhook-file", webhookFile(sinkUrl), "--wait", "4"]);
  assert.equal(r.code, 1); assert.equal(r.json.result, "FAIL");
  assert.equal(r.json.steps.at(-1).step, "inbox-file"); assert.equal(r.json.steps.at(-1).pass, false);
  assert.equal(readdirSync(inbox).length, before);
  sink.close();
  const n = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM outbox").get().n;
  const d = await py([E2E, "--dry-run", "--webhook-file", webhookFile("https://example.invalid/hook")]);
  assert.equal(d.json.result, "PASS"); assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM outbox").get().n, n);
});
