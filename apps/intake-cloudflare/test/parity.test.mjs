// Build output, config hygiene and drift checks between the PHP app and this port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATALOGUE_RAW } from "../src/catalogue-data.mjs";
import { ROOT, PHP_APP, testEnv, getReq, call } from "./helpers.mjs";
import { catalogueModule, build } from "../scripts/build.mjs";

test("embedded catalogue equals apps/intake/private/catalogue.example.json and keeps the EXAMPLE label", () => {
  const json = readFileSync(join(PHP_APP, "private", "catalogue.example.json"), "utf8");
  assert.deepEqual(CATALOGUE_RAW, JSON.parse(json));
  assert.ok(CATALOGUE_RAW.label.includes("EXAMPLE DATA - illustrative prices only"));
  assert.equal(readFileSync(join(ROOT, "src", "catalogue-data.mjs"), "utf8"), catalogueModule(json), "run node apps/intake-cloudflare/scripts/build.mjs");
  assert.throws(() => catalogueModule(JSON.stringify({ ...JSON.parse(json), label: "Prices" })), /EXAMPLE DATA/);
});

test("build: one front end, advanced-mode _worker.js, routes only /api/*", async () => {
  const out = mkdtempSync(join(tmpdir(), "intake-cf-"));
  try {
    build(out);
    assert.deepEqual(readdirSync(out).sort(), ["_headers", "_routes.json", "_worker.js", "app.js", "index.html", "styles.css"]);
    for (const f of ["index.html", "app.js", "styles.css"]) assert.equal(readFileSync(join(out, f), "utf8"), readFileSync(join(PHP_APP, "public", f), "utf8"), f);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "_routes.json"), "utf8")), { version: 1, include: ["/api/*"], exclude: [] });
    const src = readFileSync(join(out, "_worker.js"), "utf8");
    assert.ok(!/^\s*import\s/m.test(src), "bundle has no imports");
    copyFileSync(join(out, "_worker.js"), join(out, "worker-bundle.mjs"));
    const mod = await import(pathToFileURL(join(out, "worker-bundle.mjs")).href);
    const r = await call(mod.default, testEnv(), getReq("/api/catalogue.php"));
    assert.equal(r.status, 200); assert.equal(r.json.services.length, 13);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("same six endpoints as apps/intake/public/api, plus the Cloudflare-only style and envelope endpoints", async () => {
  const { ROUTES } = await import("../src/worker.mjs");
  const php = readdirSync(join(PHP_APP, "public", "api")).filter((f) => f.endsWith(".php")).map((f) => "/api/" + f);
  assert.deepEqual(Object.keys(ROUTES).sort(), [...php, "/api/style.php", "/api/envelope.php"].sort());
});

test("wrangler.toml holds no secret values; schema.sql matches the first migration", () => {
  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  for (const name of ["GROK_API_KEY", "GROK_CHAT_API_KEY", "LEAD_HMAC_SECRET", "LEAD_WEBHOOK_KEY", "LEAD_WEBHOOK_URL", "LEAD_FETCH_KEY", "STYLE_SIG_SECRET"]) {
    assert.ok(!new RegExp(`^\\s*${name}\\s*=`, "m").test(toml), `${name} must be a Pages secret, not a var`);
  }
  assert.match(toml, /binding = "DB"/);
  const strip = (s) => s.split("\n").filter((l) => !l.startsWith("--")).join("\n").trim();
  assert.equal(strip(readFileSync(join(ROOT, "schema.sql"), "utf8")), strip(readFileSync(join(ROOT, "migrations", "0001_init.sql"), "utf8")));
});
