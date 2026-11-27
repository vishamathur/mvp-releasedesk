#!/usr/bin/env node
// Builds dist/ for Cloudflare Pages (advanced mode). No dependencies, no network.
//   dist/index.html, app.js, styles.css  <- apps/intake/public (one front end for both hosts)
//   dist/_headers, dist/_routes.json      <- static/
//   dist/_worker.js                       <- src/catalogue-data.mjs + src/worker.mjs, one ES module
// Also refreshes src/catalogue-data.mjs from apps/intake/private/catalogue.example.json.
//
// --inline-static (writes dist-inline/): the worker also serves index.html, app.js and styles.css itself and there is
// no _routes.json, so every request reaches the worker. Use it only for a Direct Upload through the Cloudflare REST API
// without the Pages asset store (for example the Cloudflare API connector). Static hits then count against the
// Workers free request quota. The security headers are the same: the worker sets them on every response.
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const phpApp = join(root, "..", "intake");
const outArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const out = outArg ? join(process.cwd(), outArg) : join(root, "dist");

export function catalogueModule(json) {
  const obj = JSON.parse(json);
  if (!String(obj.label ?? "").includes("EXAMPLE DATA - illustrative prices only")) throw new Error("catalogue label must keep 'EXAMPLE DATA - illustrative prices only'");
  return "// GENERATED from apps/intake/private/catalogue.example.json by scripts/build.mjs. Do not edit by hand.\n"
    + "// EXAMPLE DATA - illustrative prices only. test/parity.test.mjs fails if this drifts from the PHP catalogue.\n"
    + `export const CATALOGUE_RAW = ${JSON.stringify(obj, null, 2)};\n`;
}

export function bundle(catalogueSrc, workerSrc) {
  const importLine = 'import { CATALOGUE_RAW } from "./catalogue-data.mjs";';
  if (!workerSrc.includes(importLine)) throw new Error("worker.mjs must import CATALOGUE_RAW from ./catalogue-data.mjs");
  const data = catalogueSrc.replace("export const CATALOGUE_RAW", "const CATALOGUE_RAW");
  return "// Built by apps/intake-cloudflare/scripts/build.mjs. Edit src/, not this file.\n" + data + "\n" + workerSrc.replace(importLine, "");
}

const STATIC_TYPES = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "styles.css": "text/css; charset=utf-8" };

export function inlineStatic(workerJs, files) {
  const marker = "const INLINE_STATIC = {}; // replaced by scripts/build.mjs --inline-static";
  if (!workerJs.includes(marker)) throw new Error("worker.mjs must define INLINE_STATIC with the build marker");
  const map = Object.fromEntries(Object.entries(files).map(([f, body]) => ["/" + f, { type: STATIC_TYPES[f], body }]));
  return workerJs.replace(marker, `const INLINE_STATIC = ${JSON.stringify(map)};`);
}

export function buildInline(outDir) {
  build(outDir);
  const files = Object.fromEntries(Object.keys(STATIC_TYPES).map((f) => [f, readFileSync(join(outDir, f), "utf8")]));
  writeFileSync(join(outDir, "_worker.js"), inlineStatic(readFileSync(join(outDir, "_worker.js"), "utf8"), files));
  for (const f of [...Object.keys(STATIC_TYPES), "_headers", "_routes.json"]) rmSync(join(outDir, f));
  return outDir;
}

export function build(outDir) {
  const catalogue = catalogueModule(readFileSync(join(phpApp, "private", "catalogue.example.json"), "utf8"));
  writeFileSync(join(root, "src", "catalogue-data.mjs"), catalogue);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of ["index.html", "app.js", "styles.css"]) copyFileSync(join(phpApp, "public", f), join(outDir, f));
  for (const f of ["_headers", "_routes.json"]) copyFileSync(join(root, "static", f), join(outDir, f));
  writeFileSync(join(outDir, "_worker.js"), bundle(catalogue, readFileSync(join(root, "src", "worker.mjs"), "utf8")));
  return outDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--inline-static")) console.log(`built ${buildInline(join(root, "dist-inline"))}`);
  else console.log(`built ${build(out)}`);
}
