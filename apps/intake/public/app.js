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
  const LABELS = { contactName: "name", email: "email", company: "company", customerId: "customer ID", projectRef: "project reference",
    changeType: "change type", legalName: "legal name", jurisdiction: "jurisdiction", intendedProduct: "intended product", sponsor: "sponsor",
    title: "title", description: "description (20+ characters)", urgency: "urgency", desiredBy: "needed-by date", customerBudgetInr: "budget",
    artifactLinks: "links (up to 5, https)", consent: "consent", route: "request type",
    catalogueOptionId: "catalogue option", pid: "request type", addOns: "add-ons" };

  // ---- route selection
  let route = null;
  const form = $("#intake-form");
  const setRoute = (r) => {
    route = r;
    $$(".option").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.route === r)));
    $("#start").hidden = false;
    $$(".route-er").forEach((x) => (x.hidden = r !== "er"));
    $$(".route-nc").forEach((x) => (x.hidden = r !== "new_customer"));
    ["customerId", "projectRef"].forEach((n) => (form.elements[n].required = r === "er"));
    ["legalName", "jurisdiction", "intendedProduct", "sponsor"].forEach((n) => (form.elements[n].required = r === "new_customer"));
    const erApp = $("#er-app"); const erOpt = $("#er-option"); const ncTpl = $("#nc-template");
    if (erApp) erApp.required = r === "er";
    if (erOpt) erOpt.required = r === "er";
    if (ncTpl) ncTpl.required = r === "new_customer";
    $("#form-title").textContent = r === "er" ? "Enhance an existing service" : "New application";
    renderEstimate();
    if (!chat.length) say("assistant", r === "er"
      ? "Hi! Pick the application and the change, then tell me anything the notes should say. I'll fill in the form as we go."
      : "Hi! Pick a template and any add-ons, then tell me about your organisation. I'll fill in the form as we go.");
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
      const [r, d] = await post("api/chat.php", { route, messages: chat.slice(-12) });
      typing.remove();
      if (!r.ok) { say("assistant", d.message || "Sorry, I couldn't respond. Please use the form."); return; }
      say("assistant", d.reply);
      if (d.route && d.route !== "unknown" && d.route !== route) setRoute(d.route);
      for (const [k, v] of Object.entries(d.draft || {})) if (form.elements[k] && !form.elements[k].value) form.elements[k].value = v;
      if (d.suggestedServices?.length) say("assistant", "Possibly relevant services (EXAMPLE list prices): " + d.suggestedServices.map((s) => `${s.name} ${inr(s.unitPriceInr)}/${s.unit}`).join("; "));
    } catch { typing.remove(); say("assistant", "Network problem. Please try again or use the form."); }
  });

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
      title: f.title.value, description: f.description.value, customerBudgetInr: f.customerBudgetInr.value || null,
      artifactLinks: f.artifactLinks.value.split(/\s+/).filter(Boolean), website: f.website.value, consent: f.consent.checked };
    if (route === "er") Object.assign(body, { customerId: f.customerId.value, projectRef: f.projectRef.value, changeType: f.changeType.value, desiredBy: f.desiredBy.value });
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
  const selectedAddOns = () => route === "new_customer"
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
  const fillErOptions = () => {
    const appId = $("#er-app").value;
    const app = catalogue.enhancements.find((a) => a.id === appId) || catalogue.enhancements[0];
    const sel = $("#er-option");
    sel.replaceChildren(...app.options.map((o) => { const opt = el("option", o.name); opt.value = o.id; return opt; }));
    const chosen = app.options.find((o) => o.id === sel.value) || app.options[0];
    $("#er-option-desc").textContent = chosen ? chosen.description : "";
    renderEstimate();
  };
  const fillAddOns = () => {
    const app = catalogue.newApplications.find((a) => a.id === $("#nc-template").value) || catalogue.newApplications[0];
    $("#nc-template-desc").textContent = app ? app.description : "";
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
        for (const opt of app.options) list.appendChild(el("p", `${opt.name} — example ${inr(opt.exampleEstimate.totalInr)}`, "hint"));
      }
      for (const app of d.newApplications) {
        list.appendChild(el("h3", "New: " + app.name));
        list.appendChild(el("p", `${app.description} Example ${inr(app.exampleEstimate.totalInr)}.`, "hint"));
      }
      $("#er-app").replaceChildren(...d.enhancements.map((a) => { const o = el("option", a.name); o.value = a.id; return o; }));
      $("#nc-template").replaceChildren(...d.newApplications.map((a) => { const o = el("option", a.name); o.value = a.id; return o; }));
      $("#er-app").addEventListener("change", fillErOptions);
      $("#er-option").addEventListener("change", () => {
        const opt = selectedOption();
        $("#er-option-desc").textContent = opt ? opt.description : "";
        renderEstimate();
      });
      $("#nc-template").addEventListener("change", fillAddOns);
      form.elements.urgency.addEventListener("change", renderEstimate);
      fillErOptions();
      fillAddOns();
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
