// Test harness only. A D1-shaped adapter over node:sqlite so the real SQL in migrations/ runs
// in-process, with no network and no Cloudflare account. Grok is never stubbed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHmac } from "node:crypto";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PHP_APP = join(ROOT, "..", "intake");
export const ORIGIN = "https://intake.vishalmathur.org";

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(ROOT, "migrations", "0001_init.sql"), "utf8"));
  const isQuery = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) {
      for (const p of params) if (p === undefined) throw new Error("D1_TYPE_ERROR: undefined cannot be bound");
      return new Stmt(this.sql, params);
    }
    async first(col) {
      const r = db.prepare(this.sql).get(...this.params);
      if (r === undefined) return null;
      return col ? r[col] : { ...r };
    }
    async all() { return { success: true, results: db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })), meta: {} }; }
    async run() { return this._run(); }
    _run() {
      if (isQuery(this.sql)) return { success: true, results: db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })), meta: { changes: 0 } };
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s._run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
}

export function testEnv(overrides = {}) {
  return {
    DB: createD1(),
    GROK_API_KEY: "",
    GROK_BASE_URL: "https://api.x.ai/v1",
    GROK_MODEL: "grok-4.3",
    ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_HOST: "intake.vishalmathur.org",
    RATE_LIMIT_MAX: "12",
    RATE_LIMIT_WINDOW_SEC: "600",
    CHAT_RATE_LIMIT_MAX: "30",
    RETENTION_DAYS: "30",
    LEAD_DELIVERY: "queue",
    LEAD_HMAC_SECRET: randomBytes(32).toString("hex"),
    ...overrides,
  };
}

export function testCtx() {
  const pending = [];
  return { pending, waitUntil: (p) => pending.push(p), passThroughOnException() {} };
}

export function jsonReq(path, body, headers = {}, method = "POST") {
  return new Request(ORIGIN + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function signedReq(path, body, secret, ts = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return new Request(ORIGIN + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Intake-Timestamp": String(ts), "X-Intake-Signature": sig, "CF-Connecting-IP": "198.51.100.9" },
    body: raw,
  });
}

export function getReq(path, ip = "203.0.113.7") {
  return new Request(ORIGIN + path, { method: "GET", headers: { "CF-Connecting-IP": ip } });
}

export async function call(worker, env, req) {
  const ctx = testCtx();
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(ctx.pending);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

export const count = (env, table, where = "1=1") => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;

/** Fails any network call made while a test runs, unless the test installs its own recorder. */
export function blockNetwork() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error(`network disabled in tests: ${String(url).slice(0, 40)}`); };
  return () => { globalThis.fetch = real; };
}

export const ER = {
  route: "er", pid: "PID-ER", catalogueOptionId: "ER-KYC-LABELS", addOns: [],
  contactName: "Jane Doe", email: "jane@example.com", company: "Acme", customerId: "cust_1042", projectRef: "PRJ-ONB-7",
  changeType: "enhancement", title: "Rename two labels", description: "Rename two labels on the onboarding screen for clarity.", urgency: "standard",
  artifactLinks: ["https://example.com/shot.png"], website: "", consent: true,
};
