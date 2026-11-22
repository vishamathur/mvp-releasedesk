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
    artifactLinks: "links (up to 5, https)", consent: "consent", route: "request type" };

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
    $("#form-title").textContent = r === "er" ? "Enhancement request" : "New customer request";
    if (!chat.length) say("assistant", r === "er"
      ? "Hi! Tell me which project this is for and what you'd like changed. I'll fill in the form as we go."
      : "Hi! Tell me about your organisation and what you'd like to build. I'll fill in the form as we go.");
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
    const body = { route, contactName: f.contactName.value, email: f.email.value, company: f.company.value, urgency: f.urgency.value,
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
  (async () => {
    try {
      const d = await (await fetch("api/catalogue.php")).json();
      $("#cat-label").textContent = `${d.label}. ${d.taxNote}`;
      const tb = $("#cat-table tbody");
      for (const s of d.services) {
        const tr = document.createElement("tr");
        const name = el("td"); name.appendChild(el("strong", s.name)); name.appendChild(el("div", s.description, "hint"));
        tr.append(name, el("td", "per " + s.unit), el("td", inr(s.unitPriceInr), "num"), el("td", s.effortDays + " days", "num"), el("td", "×" + s.riskMultiplier, "num"));
        tb.appendChild(tr);
      }
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
