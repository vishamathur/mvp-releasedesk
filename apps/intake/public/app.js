// Public intake agent front end. No secrets. All AI calls go through same-origin api/*.php.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const post = async (url, body) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return [r, await r.json().catch(() => ({}))];
  };
  const LABELS = { contactName: "name", email: "email", company: "company", customerId: "customer ID (cust_1042)", projectRef: "project reference",
    changeType: "change type", legalName: "legal name", jurisdiction: "jurisdiction", intendedProduct: "intended product", sponsor: "sponsor",
    title: "title", description: "description (20+ characters)", urgency: "urgency", desiredBy: "needed-by date", customerBudgetInr: "budget",
    artifactLinks: "links (up to 5, https)", consent: "consent", route: "request type",
    siteName: "site or brand name", purpose: "purpose of the site", audience: "audience", pages: "pages needed", mustHaveFeatures: "must-have features",
    brandAssets: "content and brand assets", domainHosting: "domain and hosting notes", budgetBand: "budget band", inspirationStyle: "inspiration photo style (upload the photo again)",
    catalogueOptionId: "catalogue option", pid: "request type", addOns: "add-ons" };

  // One random id per page load: the server hashes it into Grok's safety_identifier and rejects chat without it.
  const sessionId = "s_" + crypto.randomUUID();

  // ---- route selection
  const TITLES = { website: "Website creation", er: "Enhance an existing service", new_customer: "New application" };
  const HELLO = {
    website: "Hi! Tell me about the website: what it is for, who it is for, the pages you need, any must-have features, your content and brand assets, and when you need it. I'll fill in the form as we go.",
    er: "Hi! Pick the application and the change, then tell me anything the notes should say. I'll fill in the form as we go.",
    new_customer: "Hi! Pick a template and any add-ons, then tell me about your organisation. I'll fill in the form as we go.",
  };
  // Catalogue templates a website request may pick. Same ids as WEBSITE_TEMPLATE_IDS in private/lib/intake.php.
  const WEBSITE_TEMPLATES = ["NC-WEBSITE", "SX-LANDING-PAGE"];
  let route = null;
  const form = $("#intake-form");
  const setRoute = (r) => {
    route = r;
    $$(".option").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.route === r)));
    $("#start").hidden = false;
    // Blocks and fields name the routes they belong to. Hidden fields are never required.
    $$("[data-routes]").forEach((x) => (x.hidden = !x.dataset.routes.split(" ").includes(r)));
    $$("[data-required-for]").forEach((x) => (x.required = x.dataset.requiredFor.split(" ").includes(r)));
    const erApp = $("#er-app"); const erOpt = $("#er-option"); const ncTpl = $("#nc-template");
    if (erApp) erApp.required = r === "er";
    if (erOpt) erOpt.required = r === "er";
    if (ncTpl) ncTpl.required = r === "new_customer" || r === "website";
    $("#form-title").textContent = TITLES[r];
    $("#description-label").textContent = r === "website" ? "Anything else we should know (optional)" : "Description";
    if (catalogue) fillTemplates();
    renderEstimate();
    if (!chat.length) say("assistant", HELLO[r]);
    $("#start").scrollIntoView({ behavior: "smooth" });
  };
  $$(".option").forEach((b) => b.addEventListener("click", () => setRoute(b.dataset.route)));

  // ---- assistant chat
  const chat = [];
  const say = (role, text) => {
    chat.push({ role, content: text });
    const m = el("div", text, "msg " + role);
    $("#chat-log").appendChild(m);
    $("#chat-log").scrollTop = 1e9;
  };
  $("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chat-text"); const text = input.value.trim();
    if (!text) return;
    input.value = ""; say("user", text);
    const typing = el("div", "…", "msg assistant typing"); $("#chat-log").appendChild(typing);
    try {
      const [r, d] = await post("api/chat.php", { route, sessionId, messages: chat.slice(-12) });
      typing.remove();
      if (!r.ok) { say("assistant", d.message || "Sorry, I couldn't respond. Please use the form."); return; }
      say("assistant", d.reply);
      if (d.route && d.route !== "unknown" && d.route !== route) setRoute(d.route);
      for (const [k, v] of Object.entries(d.draft || {})) if (form.elements[k] && (!form.elements[k].value || (k === "budgetBand" && form.elements[k].value === "not_sure"))) form.elements[k].value = v;
      if (d.suggestedServices?.length) say("assistant", "Possibly relevant services (EXAMPLE list prices): " + d.suggestedServices.map((s) => `${s.name} ${inr(s.unitPriceInr)}/${s.unit}`).join("; "));
    } catch { typing.remove(); say("assistant", "Network problem. Please try again or use the form."); }
  });

  // ---- inspiration photo (website route): the server asks Grok for the visual style; only the style text is submitted.
  const STYLE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const STYLE_MAX = 4 * 1024 * 1024;
  const clearStyle = () => {
    form.elements.inspirationStyle.value = ""; form.elements.inspirationStyleSig.value = "";
    $("#inspiration-result").hidden = true; $("#inspiration-swatches").replaceChildren(); $("#inspiration-text").textContent = "";
  };
  // Large photos are redrawn in the browser as a JPEG about 1600 px wide before upload: enough to read a style, and quick
  // for the server. If the browser cannot redraw it, the original file is sent (the server still enforces 4 MB).
  const shrinkPhoto = async (file) => {
    if (file.size <= 1024 * 1024 || typeof createImageBitmap !== "function") return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
      return blob && blob.size < file.size ? blob : file;
    } catch { return file; }
  };
  const photo = $("#inspiration-photo");
  if (photo) {
    $("#inspiration-clear").addEventListener("click", () => { clearStyle(); photo.value = ""; $("#inspiration-status").textContent = ""; });
    photo.addEventListener("change", async () => {
      const st = $("#inspiration-status"); st.className = "hint"; clearStyle();
      const file = photo.files && photo.files[0];
      if (!file) { st.textContent = ""; return; }
      if (!STYLE_TYPES.includes(file.type)) { st.className = "hint error"; st.textContent = "Please choose a JPEG, PNG or WebP image."; photo.value = ""; return; }
      if (file.size > STYLE_MAX) { st.className = "hint error"; st.textContent = "That image is over 4 MB. Please choose a smaller one."; photo.value = ""; return; }
      st.textContent = "Reading the style of your photo…"; photo.disabled = true;
      try {
        const upload = await shrinkPhoto(file);
        const r = await fetch("api/style.php", { method: "POST", headers: { "content-type": upload.type, "x-session-id": sessionId }, body: upload });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) {
          st.className = "hint error";
          st.textContent = r.status === 429 ? "Too many requests. Please wait a few minutes and try again."
            : r.status === 413 ? "That image is over 4 MB." : r.status === 415 ? "Please choose a JPEG, PNG or WebP image."
            : (d.message || "Could not read the style of this photo.") + " You can still submit without it.";
          photo.value = ""; return;
        }
        form.elements.inspirationStyle.value = d.styleText; form.elements.inspirationStyleSig.value = d.styleSig;
        const sw = $("#inspiration-swatches");
        for (const c of d.style.palette) { const s = el("div", null, "swatch"); const chip = el("span"); chip.style.backgroundColor = c.hex; s.append(chip, el("small", `${c.hex} ${c.name}`)); sw.append(s); }
        $("#inspiration-text").textContent = d.styleText;
        $("#inspiration-result").hidden = false;
        st.textContent = "This style text will go with your request. Check it before you submit.";
      } catch { st.className = "hint error"; st.textContent = "Network error while reading the photo. You can still submit without it."; photo.value = ""; }
      finally { photo.disabled = false; }
    });
  }

  // ---- submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = $("#form-status"); st.textContent = ""; st.className = "";
    if (!route) { st.textContent = "Choose an option first."; return; }
    if (!form.reportValidity()) return;
    const f = form.elements;
    const picked = selectedOption();
    if (!picked) { st.className = "error"; st.textContent = "Choose a catalogue option first."; return; }
    const body = { route, pid: route === "er" ? "PID-ER" : "PID-NC", catalogueOptionId: picked.id, addOns: selectedAddOns(),
      contactName: f.contactName.value, email: f.email.value, company: f.company.value, urgency: f.urgency.value,
      title: f.title.value, description: f.description.value, customerBudgetInr: route === "website" ? null : (f.customerBudgetInr.value || null),
      artifactLinks: f.artifactLinks.value.split(/\s+/).filter(Boolean), website: f.website.value, consent: f.consent.checked };
    if (route === "er") Object.assign(body, { customerId: f.customerId.value, projectRef: f.projectRef.value, changeType: f.changeType.value, desiredBy: f.desiredBy.value });
    else if (route === "website") Object.assign(body, { legalName: f.legalName.value, jurisdiction: f.jurisdiction.value, sponsor: f.sponsor.value, desiredBy: f.desiredBy.value,
      siteName: f.siteName.value, purpose: f.purpose.value, audience: f.audience.value, pages: f.pages.value, mustHaveFeatures: f.mustHaveFeatures.value,
      brandAssets: f.brandAssets.value, domainHosting: f.domainHosting.value, budgetBand: f.budgetBand.value,
      inspirationStyle: f.inspirationStyle.value, inspirationStyleSig: f.inspirationStyleSig.value });
    else Object.assign(body, { legalName: f.legalName.value, jurisdiction: f.jurisdiction.value, intendedProduct: f.intendedProduct.value, sponsor: f.sponsor.value });
    const btn = $("#submit"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const [r, d] = await post("api/intake.php", body);
      if (r.ok && d.ok) {
        location.hash = `status=${d.referenceId}&token=${d.statusToken}`;
        st.textContent = d.message + " Bookmark this page: the link now includes your status key.";
        say("assistant", `Submitted. Your reference is ${d.referenceId}. Release Desk Lead will post updates below.`);
        loadStatusFromHash();
        return;
      }
      st.className = "error";
      st.textContent = r.status === 429 ? "Too many submissions. Please try again later."
        : d.error === "validation" ? "Please check: " + d.fields.map((k) => LABELS[k] || k).join(", ") + "." : "Something went wrong. Please try again later.";
    } catch { st.className = "error"; st.textContent = "Network error. Please try again."; }
    finally { btn.disabled = false; btn.textContent = "Submit to Release Desk Lead"; }
  });

  // ---- catalogue
  let catalogue = null;
  const selectedOption = () => {
    if (!catalogue || !route) return null;
    if (route === "er") {
      const id = $("#er-option").value;
      for (const app of catalogue.enhancements) {
        const opt = app.options.find((o) => o.id === id);
        if (opt) return opt;
      }
      return null;
    }
    return catalogue.newApplications.find((a) => a.id === $("#nc-template").value) || null;
  };
  const selectedAddOns = () => (route === "new_customer" || route === "website")
    ? $$("#nc-addons input:checked").map((i) => i.value) : [];
  const priceLines = (lines, urgency) => {
    const p = catalogue.pricing;
    let sub = 0; let maxRisk = 1;
    for (const l of lines) {
      sub += l.unitPriceInr * l.qty * l.riskMultiplier;
      maxRisk = Math.max(maxRisk, l.riskMultiplier);
    }
    const urg = p.urgency[urgency] ?? p.urgency.standard;
    let pct = p.contingencyBasePct;
    if (maxRisk >= p.highRiskThreshold) pct += p.contingencyHighRiskPct;
    if (urgency === "critical") pct += p.contingencyCriticalPct;
    const after = sub * urg;
    const total = Math.round(after + after * pct / 100);
    const roundTo = (v) => Math.round(v / p.roundToInr) * p.roundToInr;
    return { total, low: roundTo(total * p.bandLowPct / 100), expected: roundTo(total), high: roundTo(total * p.bandHighPct / 100) };
  };
  const renderEstimate = () => {
    const box = $("#example-estimate");
    const opt = selectedOption();
    if (!catalogue || !opt) { box.hidden = true; return; }
    const urgency = form.elements.urgency.value || "standard";
    const addIds = new Set(selectedAddOns());
    const useServer = urgency === "standard" && addIds.size === 0 && opt.exampleEstimate;
    const priced = useServer ? opt.exampleEstimate : priceLines([
      ...opt.lines,
      ...(opt.addOns || []).filter((a) => addIds.has(a.id)).flatMap((a) => a.lines),
    ], urgency);
    const bands = priced.budgetBandsInr || priced;
    box.hidden = false;
    box.textContent = `${catalogue.label}. Example estimate ${inr(priced.totalInr || priced.total)} (range ${inr(bands.low)}–${inr(bands.high)}, excl. GST). The submitted price is calculated on the server.`;
  };
  const optionLabel = (o) => o.showcase45 ? `${o.name} (Showcase)` : o.name;
  const paintOption = (box, opt) => {
    box.replaceChildren();
    if (!opt) return;
    if (opt.showcase45) box.append(el("span", "Showcase", "badge showcase"), document.createTextNode(" "));
    box.append(document.createTextNode(opt.description || ""));
    if (opt.demoScript) box.append(el("div", opt.demoScript));
  };
  const fillErOptions = () => {
    const appId = $("#er-app").value;
    const app = catalogue.enhancements.find((a) => a.id === appId) || catalogue.enhancements[0];
    const sel = $("#er-option");
    sel.replaceChildren(...app.options.map((o) => { const opt = el("option", optionLabel(o)); opt.value = o.id; return opt; }));
    const chosen = app.options.find((o) => o.id === sel.value) || app.options[0];
    paintOption($("#er-option-desc"), chosen);
    renderEstimate();
  };
  const templatesFor = () => catalogue.newApplications.filter((a) => route === "website" ? WEBSITE_TEMPLATES.includes(a.id) : a.id !== "NC-WEBSITE");
  const fillTemplates = () => {
    const sel = $("#nc-template");
    const keep = sel.value;
    const list = templatesFor();
    sel.replaceChildren(...list.map((a) => { const o = el("option", optionLabel(a)); o.value = a.id; return o; }));
    if (list.some((a) => a.id === keep)) sel.value = keep;
    fillAddOns();
  };
  const fillAddOns = () => {
    const app = catalogue.newApplications.find((a) => a.id === $("#nc-template").value) || templatesFor()[0];
    paintOption($("#nc-template-desc"), app);
    const box = $("#nc-addons");
    box.replaceChildren(el("legend", "Add-ons"));
    for (const add of app?.addOns || []) {
      const label = el("label");
      const input = document.createElement("input");
      input.type = "checkbox"; input.value = add.id;
      input.addEventListener("change", renderEstimate);
      label.append(input, el("span", `${add.name}. ${add.description}`));
      box.appendChild(label);
    }
    if (!(app?.addOns || []).length) box.appendChild(el("p", "No add-ons for this template.", "hint"));
    renderEstimate();
  };
  (async () => {
    try {
      const d = await (await fetch("api/catalogue.php")).json();
      catalogue = d;
      $("#cat-label").textContent = `${d.label}. ${d.taxNote}`;
      const tb = $("#cat-table tbody");
      for (const s of d.services) {
        const tr = document.createElement("tr");
        const name = el("td"); name.appendChild(el("strong", s.name)); name.appendChild(el("div", s.description, "hint"));
        tr.append(name, el("td", "per " + s.unit), el("td", inr(s.unitPriceInr), "num"), el("td", s.effortDays + " days", "num"), el("td", "×" + s.riskMultiplier, "num"));
        tb.appendChild(tr);
      }
      const list = $("#cat-options");
      for (const app of d.enhancements) {
        list.appendChild(el("h3", "Enhance: " + app.name));
        for (const opt of app.options) {
          const p = el("p", null, "hint");
          if (opt.showcase45) p.append(el("span", "Showcase", "badge showcase"), document.createTextNode(" "));
          p.append(document.createTextNode(`${opt.name} — example ${inr(opt.exampleEstimate.totalInr)}`));
          list.appendChild(p);
        }
      }
      for (const app of d.newApplications) {
        list.appendChild(el("h3", "New: " + app.name));
        const p = el("p", null, "hint");
        if (app.showcase45) p.append(el("span", "Showcase", "badge showcase"), document.createTextNode(" "));
        p.append(document.createTextNode(`${app.description} Example ${inr(app.exampleEstimate.totalInr)}.`));
        list.appendChild(p);
      }
      $("#er-app").replaceChildren(...d.enhancements.map((a) => { const o = el("option", a.name); o.value = a.id; return o; }));
      $("#er-app").addEventListener("change", fillErOptions);
      $("#er-option").addEventListener("change", () => {
        paintOption($("#er-option-desc"), selectedOption());
        renderEstimate();
      });
      $("#nc-template").addEventListener("change", fillAddOns);
      form.elements.urgency.addEventListener("change", renderEstimate);
      fillErOptions();
      fillTemplates();
    } catch { $("#cat-label").textContent = "Service list unavailable."; }
  })();

  // ---- status (key kept in the URL fragment, which is never sent to the server logs)
  let current = null;
  const renderStatus = (d) => {
    $("#status-view").hidden = false;
    $("#st-label").textContent = `${d.requestId}: ${d.statusLabel}`;
    $("#st-gate").textContent = d.nextGate ? `Next approval: ${d.nextGate.gate} (held by ${d.nextGate.owner}; a person decides)` : "";
    const ol = $("#st-steps"); ol.replaceChildren(...d.steps.map((s) => el("li", s.label, s.state)));
    if (d.status === "rejected") ol.appendChild(el("li", "Closed - not going ahead", "current"));
    const q = d.quote; $("#st-quote").hidden = !q;
    if (q) {
      $("#st-quote-lines").replaceChildren(...q.lines.map((l) => { const tr = document.createElement("tr"); tr.append(el("td", `${l.name || l.serviceId} × ${l.qty}`), el("td", inr(l.lineTotalInr), "num")); return tr; }),
        (() => { const tr = document.createElement("tr"); tr.append(el("th", "Total (expected)"), el("th", inr(q.totalInr), "num")); return tr; })());
      $("#st-quote-note").textContent = `Range ${inr(q.budgetBandsInr.low)} – ${inr(q.budgetBandsInr.high)}. ${q.note}`;
    }
    $("#st-messages").replaceChildren(...d.messages.slice().reverse().map((m) => {
      const li = el("li"); li.append(el("span", new Date(m.at).toLocaleString(), "hint"), el("strong", m.from === "lead" ? " Release Desk Lead: " : " "), el("span", m.message)); return li;
    }));
  };
  const loadStatus = async (ref, token) => {
    const r = await fetch(`api/status.php?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $("#status-view").hidden = true; alert("No request found for that reference and key."); return; }
    current = { ref, token }; renderStatus(d);
  };
  const loadStatusFromHash = () => {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("status") && p.get("token")) { $("#track-form").elements.ref.value = p.get("status"); $("#track-form").elements.token.value = p.get("token"); loadStatus(p.get("status"), p.get("token")); }
  };
  $("#track-form").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target.elements; location.hash = `status=${f.ref.value}&token=${f.token.value}`; loadStatus(f.ref.value, f.token.value); });
  $("#reply-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!current) return;
    const input = e.target.elements.message;
    const [r, d] = await post("api/status.php", { ref: current.ref, token: current.token, message: input.value });
    $("#reply-status").textContent = r.ok ? d.message : (r.status === 429 ? "Too many messages, try later." : "Could not send.");
    if (r.ok) input.value = "";
  });
  loadStatusFromHash();
})();
