// Port of apps/intake/tests/unit-tests.php. Same fixtures and expected values. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as W from "../src/worker.mjs";
import { PHP_APP } from "./helpers.mjs";

const rawCatalogue = () => JSON.parse(readFileSync(join(PHP_APP, "private", "catalogue.example.json"), "utf8"));
const throwsWith = (fn, pred) => { try { fn(); } catch (e) { return pred(e.message); } return false; };
const rejectsWith = async (fn, pred) => { try { await fn(); } catch (e) { return pred(e.message); } return false; };
const cfg = { GROK_API_KEY: "", GROK_MODEL: "grok-4.3", GROK_BASE_URL: "https://api.x.ai/v1", LEAD_BOT_ID: "46e50097-0409-4972-9be0-6ade37563135", PUBLIC_HOST: "intake.vishalmathur.org" };

test("grok body: guidelines, hashed safety id, no stop or n", async () => {
  const body = await W.grokChatBody({ GROK_MODEL: "grok-4.20-0309-non-reasoning" }, "system", "visitor text", "intake_chat", { type: "object", required: [] }, "REQ-20261122-000123");
  assert.deepEqual(body.guidelines, W.grokGuidelines());
  assert.deepEqual(body.guidelines, [
    { type: "policy", category: "nsfw", behavior: "decline" },
    { type: "policy", category: "violence", behavior: "decline" },
    { type: "policy", category: "profanity", behavior: "decline" },
  ]);
  assert.equal(body.safety_identifier, createHash("sha256").update("REQ-20261122-000123").digest("hex"));
  assert.ok(!("stop" in body) && !("n" in body));
  assert.ok(!body.safety_identifier.includes("REQ-"));
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 1200);
  assert.ok(await rejectsWith(() => W.grokChatBody({ GROK_MODEL: "grok-4.20-multi-agent" }, "s", "u", "n", { type: "object" }, "REQ-1"), (m) => m.includes("guidelines")), "multi-agent");
  assert.ok(await rejectsWith(() => W.grokSafetyIdentifier("   "), () => true), "empty id");
  assert.ok(await rejectsWith(() => W.grokChatBody({}, "s", "u", "n", { type: "object" }, "REQ-1"), (m) => m.includes("GROK_MODEL is not set")), "model");
  assert.equal(W.grokChatUrl({ GROK_BASE_URL: "https://api.x.ai/v1/" }), "https://api.x.ai/v1/chat/completions");
  assert.ok(throwsWith(() => W.grokChatUrl({ GROK_BASE_URL: "https://example.com/v1" }), (m) => m.includes("https://api.x.ai")), "base url");
});

test("catalogue: EXAMPLE services load and validate", () => {
  const c = W.catalogueLoad();
  assert.equal(Object.keys(c.byId).length, 13);
  assert.ok(c.byId["SVC-WEB"] && c.byId["SVC-AI"]);
  assert.ok(c.label.includes("EXAMPLE DATA - illustrative prices only"));
  assert.ok(c.optionById["ER-KYC-LABELS"] && c.optionById["NC-KYC"]);
  let raw = rawCatalogue(); raw.enhancements[0].options[0].billOfMaterials[0].serviceId = "SVC-NOPE";
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m.includes("catalogue_unknown_service")), "unknown service");
  raw = rawCatalogue(); raw.enhancements[0].options[0].billOfMaterials[0].qty = 0;
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m.includes("catalogue_bad_qty")), "qty");
  raw = rawCatalogue(); raw.newApplications[0].id = "SVC-KYC";
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m.includes("catalogue_duplicate_id")), "duplicate");
  raw = rawCatalogue();
  raw.services.push({ id: "SVC-CMS", name: "CMS setup", description: "A small content site.", unit: "site", unitPriceInr: 90000, effortDays: 5, riskMultiplier: 1.0 });
  raw.enhancements[0].options.push({ id: "ER-KYC-WEB", name: "KYC landing page", description: "A landing page on the KYC app.", targetServiceId: "SVC-CMS", billOfMaterials: [{ serviceId: "SVC-CMS", qty: 1 }, { serviceId: "SVC-REL", qty: 1 }] });
  raw.enhancements.push({ id: "APP-LATER", name: "Reserved application", description: "A group that can gain options later.", options: [] });
  const idx = W.catalogueIndex(raw);
  assert.ok(idx.byId["SVC-CMS"] && idx.optionById["ER-KYC-WEB"]);
  assert.deepEqual(idx.enhancements[idx.enhancements.length - 1].options, []);
  raw = rawCatalogue(); raw.enhancements[0].options[0].showcase45 = "yes";
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m === "catalogue_bad_showcase45"), "showcase flag");
  raw = rawCatalogue(); raw.newApplications[0].grokApi = ["ok", 1];
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m === "catalogue_bad_grokApi"), "grokApi");
  raw = rawCatalogue(); raw.newApplications[0].demoScript = "two\nlines";
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m === "catalogue_bad_demoScript"), "demoScript");
  raw = rawCatalogue(); raw.label = "Prices";
  assert.ok(throwsWith(() => W.catalogueIndex(raw), (m) => m === "catalogue_bad_label"), "label must stay EXAMPLE");
});

test("catalogue: showcase options price from their bill of materials", () => {
  const expect = {
    "SX-HELPDESK-BOT": ["PID-ER", 1286850, ["grok-4.7 chat with guidelines and safety_identifier"]],
    "SX-LIVE-REVIEW": ["PID-ER", 385000, ["grok-4.7 with web_search, code_execution and structured outputs"]],
    "SX-LANDING-PAGE": ["PID-NC", 836000, ["grok-4.7 structured output for HTML", "optional grok-imagine-image-2.0 for a hero image"]],
  };
  for (const [id, [pid, total, api]] of Object.entries(expect)) {
    const opt = W.catalogueRequireOption(id);
    assert.equal(opt.pid, pid, id); assert.equal(opt.showcase45, true, id); assert.deepEqual(opt.grokApi, api, id);
    assert.equal(typeof opt.demoScript, "string"); assert.ok(!opt.demoScript.includes("\n"));
    const est = W.financePriceOption(id, [], pid, "standard");
    assert.equal(est.totalInr, total, id); assert.equal(est.urgency, "standard");
  }
});

test("catalogue: BOM pricing, unknown option, pid mismatch", () => {
  const est = W.financePriceOption("ER-KYC-LABELS", [], "PID-ER", "standard");
  assert.equal(est.totalInr, 187000); assert.equal(est.subtotalInr, 170000); assert.ok(Math.abs(est.effortDays - 7.0) < 0.01);
  assert.deepEqual(est.artifactRefs, ["catalogue:ER-KYC-LABELS@example-2026-11"]);
  assert.equal(W.financePriceOption("NC-KYC", ["ADD-NC-KYC-API"], "PID-NC", "standard").totalInr, 1907850);
  assert.ok(throwsWith(() => W.financePriceOption("NO-SUCH", [], "PID-ER"), (m) => m.startsWith("Unknown catalogue option")));
  assert.ok(throwsWith(() => W.financePriceOption("NC-KYC", [], "PID-ER"), (m) => m.includes("not PID-ER")));
});

test("math: 2x UI-S + 1x REL, standard, high conf = 187,000", () => {
  const e = W.financeEstimate([{ serviceId: "SVC-UI-S", qty: 2 }, { serviceId: "SVC-REL", qty: 1 }]);
  assert.equal(e.subtotalInr, 170000); assert.equal(e.contingencyPct, 10); assert.equal(e.totalInr, 187000);
  assert.deepEqual(e.budgetBandsInr, { low: 159000, expected: 187000, high: 234000 });
  assert.ok(Math.abs(e.effortDays - 7.0) < 0.01);
});

test("math: KYC (risk 1.3) critical -> risk + urgency + contingency 20%", () => {
  const e = W.financeEstimate([{ serviceId: "SVC-KYC", qty: 1 }], "critical");
  assert.deepEqual([e.subtotalInr, e.contingencyPct, e.totalInr], [845000, 20, 1318200]);
});

test("math: unknown ids dropped, qty clamped 1..24, low confidence +5%", () => {
  const e = W.financeEstimate([{ serviceId: "NOPE", qty: 3 }, { serviceId: "SVC-UI-S", qty: 99 }], "standard", "low");
  assert.equal(e.lines.length, 1); assert.equal(e.lines[0].qty, 24); assert.equal(e.contingencyPct, 15);
});

test("policy: small ER -> approve-recommended", () => {
  assert.equal(W.financePolicy("PID-ER", W.financeEstimate([{ serviceId: "SVC-UI-S", qty: 1 }]), "high", null)[0], "approve-recommended");
});

test("policy: NC always >= review; high risk -> review; over ceiling -> reject; tiny budget -> reject; no lines -> reject", () => {
  assert.equal(W.financePolicy("PID-NC", W.financeEstimate([{ serviceId: "SVC-UI-S", qty: 1 }]), "high", null)[0], "review");
  assert.equal(W.financePolicy("PID-ER", W.financeEstimate([{ serviceId: "SVC-REG", qty: 1 }]), "high", null)[0], "review");
  const ceiling = W.financePolicy("PID-ER", W.financeEstimate([{ serviceId: "SVC-KYC", qty: 10 }]), "high", null);
  assert.equal(ceiling[0], "reject-suggested");
  assert.equal(ceiling[1][0], "Estimate exceeds the web-intake ceiling of INR 5,000,000.");
  assert.equal(W.financePolicy("PID-ER", W.financeEstimate([{ serviceId: "SVC-UI-M", qty: 1 }]), "high", 10000)[0], "reject-suggested");
  assert.equal(W.financePolicy("PID-ER", W.financeEstimate([]), "high", null)[0], "reject-suggested");
});

test("assess: missing GROK_API_KEY throws and does not invent a recommendation", async () => {
  assert.ok(await rejectsWith(() => W.financeAssess({ ...cfg, GROK_API_KEY: "" }, { pid: "PID-NC", text: "new KYC onboarding", urgency: "standard" }), (m) => m.includes("GROK_API_KEY is not set")));
});

test("assess: explicit lines from Lead bypass Grok", async () => {
  const a = await W.financeAssess(cfg, { pid: "PID-ER", text: "", lines: [{ serviceId: "SVC-SEC", qty: 1 }] });
  assert.equal(a.source, "explicit-lines"); assert.equal(a.estimate.totalInr, 220000);
  assert.equal(a.gate.decidedBy, null); assert.equal(a.gate.status, "pending");
});

test("assess: the Grok finance prompt fences visitor text and escapes slashes like json_encode", () => {
  const [system, user] = W.financePrompt("PID-ER", "standard", null, "see https://x.test/a");
  assert.ok(system.endsWith(W.GROK_UNTRUSTED_RULES));
  assert.equal(user, '<visitor_input>\n{"pid":"PID-ER","urgency":"standard","statedBudgetInr":null,"request":"see https:\\/\\/x.test\\/a"}\n</visitor_input>');
});

const base = { route: "er", pid: "PID-ER", catalogueOptionId: "ER-KYC-LABELS", addOns: [],
  contactName: "Jane Doe", email: "jane@example.com", company: "Acme", customerId: "cust_1042", projectRef: "PRJ-ONB-7",
  changeType: "enhancement", title: "Rename two labels", description: "Rename two labels on the onboarding screen for clarity.", urgency: "standard", consent: true };

test("validation: valid ER passes; bad ids/date/budget/route caught", () => {
  assert.deepEqual(W.intakeValidate(base)[0], []);
  assert.ok(W.intakeValidate({ ...base, customerId: "CUST-1042" })[0].includes("customerId"), "hyphenated customer id");
  assert.deepEqual(W.intakeValidate({ ...base, customerId: "cust_northwind" })[0], [], "portfolio customer id");
  const e = W.intakeValidate({ ...base, customerId: "bad id with spaces", projectRef: "", desiredBy: "2026-02-30", customerBudgetInr: "lots", urgency: "asap" })[0];
  assert.deepEqual([...e].sort(), ["customerBudgetInr", "customerId", "desiredBy", "projectRef", "urgency"]);
  assert.ok(W.intakeValidate({ ...base, route: "x" })[0].includes("route"));
  assert.ok(W.intakeValidate({ ...base, catalogueOptionId: "NO-SUCH" })[0].includes("catalogueOptionId"));
  assert.ok(W.intakeValidate({ ...base, catalogueOptionId: "NC-KYC" })[0].includes("pid"));
});

test("validation: NC requires legalName/jurisdiction/intendedProduct/sponsor", () => {
  const e = W.intakeValidate({ ...base, route: "new_customer", pid: "PID-NC", catalogueOptionId: "NC-KYC" })[0];
  assert.deepEqual([...e].sort(), ["intendedProduct", "jurisdiction", "legalName", "sponsor"]);
});

test("handoff: proposed handoff passes validate-handoff (ER -> estimation, NC -> discovery)", async () => {
  for (const [route, [pid, stage, opt]] of Object.entries({ er: ["PID-ER", "estimation", "ER-KYC-LABELS"], new_customer: ["PID-NC", "discovery", "NC-KYC"] })) {
    const d = W.intakeValidate({ ...base, route, pid, catalogueOptionId: opt, legalName: "Acme Pvt Ltd", jurisdiction: "India", intendedProduct: "Lending", sponsor: "R. Rao, CFO" })[1];
    const rid = "REQ-20261122-000123";
    const fin = await W.financeAssess({ ...cfg, GROK_API_KEY: "" }, { pid, text: d.description, urgency: "standard", lines: [{ serviceId: "SVC-UI-S", qty: 1 }] });
    const card = W.intakeBuildCard(cfg, rid, d, fin, "2026-11-22T12:00:00Z");
    const h = card.proposedHandoff;
    assert.deepEqual(W.handoffV1Validate(h, "lead"), []);
    assert.equal(h.pid, pid); assert.equal(h.stage, stage); assert.equal(h.to, "change-analyst"); assert.equal(h.thread.threadId, "thr_20261122000123");
    assert.equal(card.to, "lead"); assert.ok(!("leadBotId" in card)); assert.equal(card.kind, "intake-card"); assert.ok(!("pidState" in card));
    assert.ok(h.artifactRefs.includes(`finance:${rid}@preliminary`)); assert.ok(h.summary.includes("INR"));
    assert.ok(h.summary.includes("INR 49,500 (bands 42,000 / 50,000 / 62,000"), h.summary);
  }
});

const web = { route: "website", pid: "PID-NC", catalogueOptionId: "NC-WEBSITE", addOns: [],
  contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd", jurisdiction: "India", sponsor: "R. Rao, CFO",
  siteName: "Acme Lending", purpose: "Explain our lending products and collect enquiries.", audience: "Small business owners in India",
  pages: "Home, Products, About, Contact", mustHaveFeatures: "Contact form", brandAssets: "Logo and colours exist, copy is missing",
  domainHosting: "We own acmelending.example", budgetBand: "150k_300k", desiredBy: "2027-01-31", urgency: "standard", consent: true };

test("website: valid request passes with no title or description; types are derived", () => {
  const [e, d] = W.intakeValidate(web);
  assert.deepEqual(e, []);
  assert.equal(d.requestType, "website-creation"); assert.equal(d.pid, "PID-NC");
  assert.equal(d.title, "Website: Acme Lending"); assert.equal(d.intendedProduct, "Website: Acme Lending");
  assert.ok(d.description.includes("Pages needed: Home, Products, About, Contact") && d.description.includes("Needed by: 2027-01-31"), d.description);
  assert.equal(d.customerBudgetInr, 300000, "band ceiling becomes the stated budget");
  const d2 = W.intakeValidate({ ...web, budgetBand: "not_sure", description: "Please call before building." })[1];
  assert.equal(d2.customerBudgetInr, null); assert.ok(d2.description.includes("Notes: Please call before building."));
  assert.deepEqual(W.intakeValidate({ ...web, catalogueOptionId: "SX-LANDING-PAGE" })[0], []);
  assert.equal(W.intakeValidate({ ...web, budgetBand: undefined })[1].budgetBand, "not_sure", "band defaults to not_sure");
  assert.equal(W.intakeValidate({ ...web, customerBudgetInr: "120000" })[1].customerBudgetInr, 120000, "a typed budget wins over the band");
});

test("website: missing brief, bad band, bad date, wrong template and wrong pid are rejected", () => {
  const e = W.intakeValidate({ ...web, legalName: "", jurisdiction: "", sponsor: "", siteName: "", purpose: "", audience: "", pages: "" })[0];
  assert.deepEqual([...e].sort(), ["audience", "jurisdiction", "legalName", "pages", "purpose", "siteName", "sponsor"]);
  assert.ok(W.intakeValidate({ ...web, budgetBand: "free" })[0].includes("budgetBand"), "band");
  assert.ok(W.intakeValidate({ ...web, budgetBand: ["under_50k"] })[0].includes("budgetBand"), "band must be a string");
  assert.ok(W.intakeValidate({ ...web, desiredBy: "2027-02-30" })[0].includes("desiredBy"), "date");
  assert.ok(W.intakeValidate({ ...web, catalogueOptionId: "NC-KYC" })[0].includes("catalogueOptionId"), "non-website template");
  assert.ok(W.intakeValidate({ ...web, pid: "PID-ER" })[0].includes("pid"), "pid must be PID-NC");
  assert.ok(W.intakeValidate({ ...web, addOns: ["ADD-NC-KYC-API"] })[0].includes("addOns"), "add-on of another template");
  assert.deepEqual(W.intakeValidate({ ...web, addOns: ["ADD-NC-WEB-FORMS", "ADD-NC-WEB-AI"] })[0], [], "website add-ons");
  assert.ok(W.intakeValidate({ ...web, purpose: "x".repeat(601) })[0].includes("purpose"), "purpose max 600");
});

test("website: card carries type and brief; handoff goes to change-analyst at discovery and validates", async () => {
  const [e, d] = W.intakeValidate(web);
  assert.deepEqual(e, []);
  const rid = "REQ-20261127-000321";
  const fin = await W.financeAssess(cfg, { pid: "PID-NC", text: d.description, urgency: "standard", customerBudgetInr: d.customerBudgetInr, requestId: rid, catalogueOptionId: "NC-WEBSITE", addOns: [] });
  assert.equal(fin.source, "catalogue-option");
  const card = W.intakeBuildCard(cfg, rid, d, fin, "2026-11-27T12:00:00Z");
  assert.equal(card.pid, "PID-NC"); assert.equal(card.requestType, "website-creation"); assert.equal(card.channel, "#new-customer");
  assert.deepEqual(card.requestDetails, { website: { siteName: "Acme Lending", purpose: web.purpose, audience: web.audience, pages: web.pages,
    mustHaveFeatures: "Contact form", brandAssets: web.brandAssets, domainHosting: web.domainHosting, budgetBand: "150k_300k", deadline: "2027-01-31" } });
  assert.deepEqual(card.customer, { legalName: "Acme Pvt Ltd", jurisdiction: "India", intendedProduct: "Website: Acme Lending", sponsor: "R. Rao, CFO", desiredBy: "2027-01-31" });
  assert.equal(card.catalogueOptionId, "NC-WEBSITE"); assert.equal(card.to, "lead"); assert.ok(!("pidState" in card));
  const h = card.proposedHandoff;
  assert.deepEqual(W.handoffV1Validate(h, "lead"), []);
  assert.equal(h.pid, "PID-NC"); assert.equal(h.stage, "discovery"); assert.equal(h.to, "change-analyst");
  assert.ok(h.summary.includes("website-creation") && h.summary.includes(`intake:${rid}`) && h.summary.includes("needed by 2027-01-31"), h.summary);
  assert.ok(h.artifactRefs.includes(`intake:${rid}`));
});

test("request types: ER defect/regulatory/enhancement and NC carry requestType; non-website cards have no website details", async () => {
  for (const ct of ["enhancement", "defect", "regulatory"]) {
    const [e, d] = W.intakeValidate({ ...base, changeType: ct });
    assert.deepEqual(e, []); assert.equal(d.requestType, ct);
  }
  const fin = await W.financeAssess(cfg, { pid: "PID-ER", text: "", lines: [{ serviceId: "SVC-UI-S", qty: 1 }] });
  const card = W.intakeBuildCard(cfg, "REQ-20261127-000322", W.intakeValidate({ ...base, changeType: "defect" })[1], fin, "2026-11-27T12:00:00Z");
  assert.equal(card.requestType, "defect"); assert.equal(card.requestDetails, null); assert.equal(card.pid, "PID-ER");
  const [e, d] = W.intakeValidate({ ...base, route: "new_customer", pid: "PID-NC", catalogueOptionId: "NC-KYC", legalName: "Acme Pvt Ltd", jurisdiction: "India", intendedProduct: "Lending", sponsor: "R. Rao, CFO" });
  assert.deepEqual(e, []); assert.equal(d.requestType, "new-application");
});

test("chat: schema offers the website route, every draft field is required, budget band is enumerated", () => {
  const cat = W.catalogueLoad();
  const sch = W.chatSchema(Object.keys(cat.byId));
  assert.ok(sch.properties.route.enum.includes("website"));
  for (const f of ["siteName", "purpose", "audience", "pages", "mustHaveFeatures", "brandAssets", "domainHosting", "budgetBand", "desiredBy"]) {
    assert.ok(f in sch.properties.draft.properties && sch.properties.draft.required.includes(f), f);
  }
  assert.equal(sch.properties.draft.properties.description.maxLength, 2000); assert.equal(sch.properties.draft.properties.purpose.maxLength, 600);
  assert.ok(W.CHAT_DRAFT_FIELDS.length <= sch.properties.missingFields.maxItems);
  assert.ok(W.chatSystemPrompt(cat).includes("website: Website creation"));
});

test("handoff validator: rejects bot approval, non-lead stage-handoff, extra fields, wrong thread", () => {
  const h = { v: 1, kind: "stage-return", pid: "PID-ER", pidVersion: "1.1.0", requestId: "REQ-20261122-000123", thread: { channel: "lead-chat", threadId: "thr_20261122000123" },
    from: "change-analyst", to: "lead", stage: "finance-approval", action: "return", summary: "s", artifactRefs: [], memoryKey: "pid.state.REQ-20261122-000123",
    humanGate: { gate: "finance-approval", status: "approved", decidedBy: "change-analyst", note: "ok" } };
  assert.ok(W.handoffV1Validate(h, "change-analyst").includes("bot_cannot_approve"));
  h.humanGate = { gate: "finance-approval", status: "approved", decidedBy: "Vishal Mathur", note: '2026-11-22T18:00:00+05:30 verbatim: "approve"' };
  assert.deepEqual(W.handoffV1Validate(h, "change-analyst"), []);
  assert.notDeepEqual(W.handoffV1Validate({ ...h, kind: "stage-handoff", from: "security" }, "security"), []);
  assert.notDeepEqual(W.handoffV1Validate({ extra: 1, ...h }, "change-analyst"), []);
  assert.notDeepEqual(W.handoffV1Validate({ ...h, thread: { channel: "#er-intake", threadId: "x" } }, "change-analyst"), []);
  assert.deepEqual(W.handoffV1Validate({ pidState: [], ...h }, "change-analyst"), ["only_lead_writes_pid_state"]);
});

test("status: lifecycle transitions", () => {
  assert.ok(W.statusAllowedTransition("received", "estimating") && W.statusAllowedTransition("estimating", "finance-approval") && W.statusAllowedTransition("build", "security"));
  assert.ok(!W.statusAllowedTransition("finance-approval", "received") && !W.statusAllowedTransition("done", "build") && !W.statusAllowedTransition("rejected", "received"));
  assert.ok(W.statusAllowedTransition("security", "rejected"));
  assert.equal(W.STATUS_FROM_STAGE["test-gate"], "build"); assert.equal(W.STATUS_FROM_STAGE.proposal, "estimating"); assert.equal(W.STATUS_FROM_STAGE["release-gate"], "release");
});

test("status: Lead update validation (gate owner, approval wording, quote)", () => {
  const u = { requestId: "REQ-20261122-000123", updateId: "u-0001", from: "lead", stage: "finance-approval", message: "Estimate ready; finance review next.",
    nextGate: { gate: "finance-approval", owner: "change-analyst" }, quote: { totalInr: 187000, budgetBandsInr: { low: 159000, expected: 187000, high: 234000 }, lines: [{ serviceId: "SVC-UI-S", qty: 2, lineTotalInr: 90000 }] } };
  const [e, c] = W.statusValidateUpdate(u); assert.deepEqual(e, []); assert.equal(c.status, "finance-approval");
  assert.deepEqual(W.statusValidateUpdate({ ...u, nextGate: { gate: "finance-approval", owner: "lead" } })[0], ["nextGate"]);
  assert.notDeepEqual(W.statusValidateUpdate({ ...u, message: "Your request is approved." })[0], []);
  assert.deepEqual(W.statusValidateUpdate({ ...u, message: "Finance approved by Vishal on 22 Nov." })[0], []);
  assert.deepEqual(W.statusValidateUpdate({ ...u, from: "change-analyst" })[0], ["from"]);
});

test("php helpers: trim, round, number_format, (int), is_numeric, app_clean", () => {
  assert.equal(W.phpTrim("\u00a0 x \n"), "\u00a0 x");
  assert.equal(W.phpRound(2.5), 3); assert.equal(W.phpRound(-2.5), -3); assert.equal(W.phpRound(1.005, 2), 1.01); assert.equal(W.phpRound(7.05, 1), 7.1);
  assert.equal(W.numberFormat(1286850), "1,286,850"); assert.equal(W.numberFormat(0), "0");
  assert.equal(W.phpInt("12abc"), 12); assert.equal(W.phpInt("1e3"), 1000); assert.equal(W.phpInt(2.9), 2); assert.equal(W.phpInt("x"), 0); assert.equal(W.phpInt(true), 1);
  assert.ok(W.phpIsNumeric(" 12") && W.phpIsNumeric("1e3") && W.phpIsNumeric("12 ") && !W.phpIsNumeric("lots") && !W.phpIsNumeric(true));
  assert.equal(W.appClean("  a\u202Eb\u0007c  "), "abc");
  assert.equal(W.appClean(42), "42"); assert.equal(W.appClean(["x"]), ""); assert.equal(W.appClean("😀😀😀", 2), "😀😀");
  assert.equal(W.appLen("😀a"), 2);
});

test("inline static: build --inline-static serves the front end from the worker, normal build serves nothing", async () => {
  const { inlineStatic } = await import("../scripts/build.mjs");
  assert.equal(W.inlineStaticFile("/"), null);
  assert.equal(W.inlineStaticFile("/app.js"), null);
  const src = readFileSync(join(import.meta.dirname, "..", "src", "worker.mjs"), "utf8");
  const out = inlineStatic(src, { "index.html": "<h1>x</h1>", "app.js": "1", "styles.css": "a{}" });
  assert.ok(out.includes('"/index.html":{"type":"text/html; charset=utf-8","body":"<h1>x</h1>"}'));
  assert.throws(() => inlineStatic("no marker", {}), /INLINE_STATIC/);
  const files = { "/index.html": { type: "text/html", body: "i" } };
  assert.equal(W.inlineStaticFile("/", files).body, "i");
  assert.equal(W.inlineStaticFile("/api/chat.php", files), null);
});
