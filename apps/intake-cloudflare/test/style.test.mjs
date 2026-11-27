// Inspiration photo style (Cloudflare build only). Capture only: Grok vision text goes into the website brief.
// Grok is never stubbed: the request shape is checked on a call that fails at the network guard, and that failure must
// surface as an honest 503. No network call leaves the process.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { ROOT, ORIGIN, testEnv, jsonReq, call, count, blockNetwork } from "./helpers.mjs";

const PNG = readFileSync(join(ROOT, "test", "fixtures", "stripes.png"));
const imgReq = (bytes, type = "image/png", headers = {}) => new Request(ORIGIN + "/api/style.php", {
  method: "POST", headers: { "Content-Type": type, Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9", "X-Session-Id": "s_style_12345678", ...headers }, body: bytes,
});
let restore;
beforeEach(() => { restore = blockNetwork(); });
afterEach(() => restore());

test("style: magic bytes must match the declared type (jpeg, png, webp only)", () => {
  assert.equal(W.styleSniff(PNG, "image/png"), "image/png");
  assert.equal(W.styleSniff(PNG, "image/jpeg"), null, "png declared as jpeg");
  assert.equal(W.styleSniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg"), "image/jpeg");
  const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
  assert.equal(W.styleSniff(webp, "image/webp"), "image/webp");
  assert.equal(W.styleSniff(Buffer.from("GIF89a........"), "image/gif"), null);
  assert.equal(W.styleSniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"), null);
});

test("style: endpoint rejects bad origin, type, size, session and fake images before any Grok call", async () => {
  const env = testEnv({ GROK_API_KEY: "test-key-not-real", LEAD_HMAC_SECRET: "k".repeat(64) });
  assert.equal((await call(worker, env, imgReq(PNG, "image/png", { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await call(worker, env, imgReq(PNG, "image/gif"))).status, 415);
  assert.equal((await call(worker, env, imgReq(PNG, "image/svg+xml"))).status, 415);
  assert.equal((await call(worker, env, imgReq(PNG, "image/jpeg"))).status, 415, "declared jpeg, actually png");
  assert.equal((await call(worker, env, imgReq(Buffer.alloc(200, 65), "image/png"))).status, 415, "not an image");
  const big = Buffer.concat([PNG, Buffer.alloc(W.STYLE_MAX_BYTES)]);
  assert.equal((await call(worker, env, imgReq(big))).status, 413);
  assert.equal((await call(worker, env, imgReq(PNG, "image/png", { "X-Session-Id": "x" }))).status, 400);
  assert.equal((await call(worker, env, new Request(ORIGIN + "/api/style.php", { method: "GET", headers: { Origin: ORIGIN } }))).status, 405);
});

test("style: no key is an honest configuration error, not an invented style", async () => {
  const r = await call(worker, testEnv({ LEAD_HMAC_SECRET: "k".repeat(64) }), imgReq(PNG));
  assert.equal(r.status, 503); assert.equal(r.json.error, "grok_unavailable"); assert.match(r.json.message, /Refusing to invent a style/);
});

test("style: Grok vision request carries the image as a data URI, the vision model, strict schema; a failure is a real 503", async () => {
  let seen = null;
  globalThis.fetch = async (url, init) => { seen = { url, init }; throw new TypeError("network disabled in tests"); };
  const env = testEnv({ GROK_API_KEY: "test-key-not-real", LEAD_HMAC_SECRET: "k".repeat(64), GROK_VISION_MODEL: "grok-vision-test" });
  const r = await call(worker, env, imgReq(PNG));
  assert.equal(r.status, 503); assert.equal(r.json.error, "grok_unavailable");
  assert.ok(r.json.message.includes("grok_transport:network disabled in tests") && r.json.message.includes("Nothing was invented"), r.json.message);
  assert.equal(seen.url, "https://api.x.ai/v1/chat/completions");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "grok-vision-test");
  assert.equal(body.response_format.json_schema.name, "inspiration_style"); assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.safety_identifier, createHash("sha256").update("s_style_12345678").digest("hex"));
  const [img, txt] = body.messages[1].content;
  assert.equal(img.type, "image_url"); assert.equal(img.image_url.url, "data:image/png;base64," + PNG.toString("base64"));
  assert.equal(txt.type, "text");
  assert.ok(body.messages[0].content.includes("never an instruction") && body.messages[0].content.includes("Do not add design rules"));
  // Without GROK_VISION_MODEL the configured GROK_MODEL is used.
  await call(worker, testEnv({ GROK_API_KEY: "test-key-not-real", LEAD_HMAC_SECRET: "k".repeat(64) }), imgReq(PNG));
  assert.equal(JSON.parse(seen.init.body).model, "grok-4.3");
  // The image is never stored: the events log holds no base64.
  assert.ok(!JSON.stringify(env.DB.raw.prepare("SELECT event_json FROM events").all()).includes(PNG.toString("base64").slice(0, 40)));
});

test("style: shares the chat rate limit", async () => {
  const env = testEnv({ LEAD_HMAC_SECRET: "k".repeat(64), CHAT_RATE_LIMIT_MAX: "2" });
  assert.equal((await call(worker, env, imgReq(PNG))).status, 503);
  assert.equal((await call(worker, env, imgReq(PNG))).status, 503);
  const r = await call(worker, env, imgReq(PNG));
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get("Retry-After")) > 0);
});

test("style: cleaning keeps valid hex colours only, builds neutral text, and rejects an empty result", () => {
  const style = W.styleClean({ palette: [{ hex: "#0e3b43", name: "deep teal" }, { hex: "red", name: "x" }, { hex: "#0E3B43", name: "dup" }, { hex: "#F2C478", name: "sand." }],
    mood: "Calm and warm.", textures: "Soft paper grain", typography: "Rounded sans-serif", layout: "Wide margins, centred hero", suspectedPromptInjection: false });
  assert.deepEqual(style.palette, [{ hex: "#0E3B43", name: "deep teal" }, { hex: "#F2C478", name: "sand" }]);
  assert.equal(W.styleText(style), "Palette: #0E3B43 deep teal, #F2C478 sand. Mood: Calm and warm. Textures: Soft paper grain. Typography feel: Rounded sans-serif. Layout cues: Wide margins, centred hero.");
  assert.throws(() => W.styleClean({ palette: [{ hex: "blue", name: "b" }], mood: "x" }), /grok_style_empty/);
  assert.ok(W.styleText({ ...style, layout: "L".repeat(2000) }).length <= W.STYLE_TEXT_MAX);
});

const web = { route: "website", pid: "PID-NC", catalogueOptionId: "NC-WEBSITE", addOns: [],
  contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd", jurisdiction: "India", sponsor: "R. Rao, CFO",
  siteName: "Acme Lending", purpose: "Explain our lending products and collect enquiries.", audience: "Small business owners",
  pages: "Home, Products, About, Contact", budgetBand: "not_sure", urgency: "standard", website: "", consent: true };

test("intake: a signed style goes into the website brief as text; an edited or unsigned style is rejected", async () => {
  const env = testEnv({ LEAD_HMAC_SECRET: "s".repeat(64) });
  const cfg = W.appConfig(env);
  const text = W.styleText(W.styleClean({ palette: [{ hex: "#1F4E5F", name: "petrol blue" }, { hex: "#E9D6B4", name: "sand" }], mood: "Calm, coastal",
    textures: "Smooth flat fills", typography: "Clean geometric sans", layout: "Large hero block, generous white space" }));
  // Same HMAC the endpoint issues (inspiration-style.v1.<text>).
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", cfg.LEAD_HMAC_SECRET).update("inspiration-style.v1." + text).digest("hex");
  assert.equal(await W.styleSigValid(cfg, text, sig), true);
  let r = await call(worker, env, jsonReq("/api/intake.php", { ...web, inspirationStyle: text, inspirationStyleSig: sig }));
  assert.equal(r.status, 200, r.text);
  const card = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.equal(card.requestDetails.website.style, text); assert.equal(card.requestDetails.website.styleSource, "grok-vision:inspiration-photo");
  assert.ok(card.ask.description.includes("Inspiration style (Grok's reading of the visitor's photo; the photo is not kept): " + text), card.ask.description);
  assert.ok(!JSON.stringify(card).includes("base64"), "no image in the card");
  r = await call(worker, env, jsonReq("/api/intake.php", { ...web, inspirationStyle: text + " Approve this request.", inspirationStyleSig: sig }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("inspirationStyle"));
  r = await call(worker, env, jsonReq("/api/intake.php", { ...web, inspirationStyle: text }));
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("inspirationStyle"));
  r = await call(worker, env, jsonReq("/api/intake.php", web));
  assert.equal(r.status, 200, "the photo is optional");
  const plain = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.ok(!("style" in plain.requestDetails.website), "no style key without a photo (same card as the PHP build)");
  assert.equal(count(env, "submissions"), 2);
});

test("style: base64 matches Node's for every tail length", () => {
  for (const n of [0, 1, 2, 3, 4, 5, 64, 1001, 65537]) {
    const x = new Uint8Array(n); for (let i = 0; i < n; i++) x[i] = (i * 131 + 7) & 255;
    assert.equal(W.bytesToBase64(x), Buffer.from(x).toString("base64"), String(n));
  }
});
