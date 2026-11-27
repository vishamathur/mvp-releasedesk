// Static checks on the shared front end (apps/intake/public). No network, no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "intake", "public");
const html = readFileSync(join(pub, "index.html"), "utf8");
const js = readFileSync(join(pub, "app.js"), "utf8");
const css = readFileSync(join(pub, "styles.css"), "utf8");

test("front end: every #id that app.js looks up exists in index.html", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\("#([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test("front end: every form field app.js reads by name exists in index.html", () => {
  const names = new Set([...html.matchAll(/\bname="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\b(?:f|form\.elements|e\.target\.elements)\.([A-Za-z]+)\.(?:value|checked)/g)].map((m) => m[1]));
  const missing = [...used].filter((n) => !names.has(n));
  assert.deepEqual(missing, []);
});

test("front end: example-data labelling is kept on the page and on every catalogue card", () => {
  assert.ok(html.includes("EXAMPLE DATA"), "page badge");
  assert.ok(html.includes("Service names and prices on this page are EXAMPLE data"), "footer notice");
  assert.ok(js.includes('el("span", "EXAMPLE DATA", "badge")'), "card badge");
  assert.ok(js.includes('el("dt", "Example price")'), "card price label");
});

test("front end: CSP-safe (no inline scripts, inline styles or external assets)", () => {
  assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, "inline script");
  assert.equal(/\sstyle="/i.test(html), false, "inline style attribute");
  assert.equal(/\son[a-z]+="/i.test(html), false, "inline event handler");
  assert.equal(/(?:src|href)="(?:https?:)?\/\//i.test(html), false, "external asset");
  assert.equal(/@import|url\(\s*["']?https?:/i.test(css), false, "external CSS");
  assert.equal(/setAttribute\(\s*["']style/.test(js), false, "style attribute from script");
});

test("front end: the three request types and their PIDs are offered", () => {
  for (const r of ["website", "er", "new_customer"]) assert.ok(html.includes(`data-route="${r}"`), r);
  assert.ok(html.includes("PID-ER") && html.includes("PID-NC"));
});

// WCAG 2.x relative luminance and contrast ratio
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("front end: palette text pairs meet WCAG 2.2 AA (4.5:1)", () => {
  const v = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const pairs = [["ink", "surface"], ["ink", "bg"], ["muted", "surface"], ["muted", "bg"], ["accent", "surface"], ["accent", "accent-soft"],
    ["surface", "accent"], ["surface", "accent-hover"], ["surface", "brand"], ["surface", "brand-2"], ["warn-ink", "warn-bg"],
    ["ok", "ok-soft"], ["err", "surface"], ["accent-hover", "accent-soft"]];
  for (const [fg, bg] of pairs) {
    assert.ok(v[fg] && v[bg], `${fg}/${bg} defined`);
    const r = ratio(v[fg], v[bg]);
    assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
  }
  assert.ok(ratio(v.muted, "#eef1f5") >= 4.5, "muted on step pill");
  assert.ok(ratio(v.muted, "#eef2f7") >= 4.5, "muted on table head");
  assert.ok(ratio("#dbe6f3", v.brand) >= 4.5 && ratio("#dbe6f3", v["brand-2"]) >= 4.5, "hero lede");
  assert.ok(ratio("#a9cdf2", v["brand"]) >= 4.5, "hero eyebrow");
});
