#!/usr/bin/env node
// Builds dist/ for Cloudflare Pages (advanced mode). No dependencies, no network.
//   dist/index.html, app.js, styles.css  <- apps/intake/public (one front end for both hosts)
//   dist/_headers, dist/_routes.json      <- static/
//   dist/_worker.js                       <- src/catalogue-data.mjs + src/worker.mjs, one ES module
// Also refreshes src/catalogue-data.mjs from apps/intake/private/catalogue.example.json.
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const phpApp = join(root, "..", "intake");
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, "dist");

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
  console.log(`built ${build(out)}`);
}
