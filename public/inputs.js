// Inputs (every assumption in one place), Tax Plan (the full-year tax engine) and Valuation (cap-rate calculator
// with a live market search). Shared assumptions live in /api/inputs; building values and mortgages in
// /api/properties; loans and Fed Funds spreads in /api/loans; Plaid connections in /api/plaid.
(function () {
  if (!document.querySelector('link[href="/inputs.css"]')) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/inputs.css" }));
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 1) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const who = (e) => String(e || "").replace(/@.*/, "").replace(/^mrice$/, "Matt").replace(/^jen$/, "Jen");
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sheet = (title, lede) => h("article", { class: "sheet dash ws inp" }, h("h2", {}, title), lede ? h("p", { class: "lede" }, lede) : null);
  const section = (title, note) => h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  const kpis = (items) => h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
    h("div", { class: "kpi-label" }, k.label), h("div", { class: "kpi-value" + (String(k.value).startsWith("−") ? " neg" : "") }, k.value), k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  function table(cols, rows, foot) {
    const t = h("table", { class: "grid dgrid" });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    t.append(h("tbody", {}, rows.map((r) => h("tr", { class: r._class || null }, cols.map((c) => { const v = c.get(r), raw = c.raw ? c.raw(r) : null; return h("td", { class: [c.num ? "num" : "", raw != null && raw < 0 ? "neg" : ""].filter(Boolean).join(" ") || null }, v); })))));
    if (foot) t.append(h("tfoot", {}, h("tr", {}, cols.map((c) => h("td", { class: c.num ? "num" : null }, foot[c.key] ?? "")))));
    return h("div", { class: "sheet-scroll", tabindex: "0" }, t);
  }
  const toast = (el, msg, kind = "ok") => { const t = h("div", { class: `ws-toast ${kind}`, role: "status" }, msg); el.prepend(t); setTimeout(() => t.remove(), kind === "err" ? 7000 : 2500); };
  async function api(url, body) {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Something went wrong. Try again."); e.data = d.data; throw e; }
    return d;
  }
  // form helpers
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const numIn = (v, step = "any", attrs = {}) => h("input", { type: "number", step, value: v ?? "", ...attrs });
  const txtIn = (v, attrs = {}) => h("input", { type: "text", value: v ?? "", ...attrs });
  const dateIn = (v) => h("input", { type: "date", value: v ?? "" });
  const check = (label, v) => { const i = h("input", { type: "checkbox", checked: !!v }); return { el: h("label", { class: "tax-field tax-check" }, i, h("span", {}, label)), i }; };
  const sel = (opts, v) => h("select", { class: "ws-select" }, opts.map(([k, l]) => { const o = h("option", { value: k }, l); if (String(k) === String(v ?? "")) o.selected = true; return o; }));

  /* ---------- state ---------- */
  let S = null; // { inputs, params, baseParams }
  let loadP = null;
  function load(force) {
    if (!loadP || force) loadP = api("/api/inputs").then((d) => { S = d; pushDashTax(); return d; });
    return loadP;
  }
  const save = (op, extra) => api("/api/inputs", { version: S.inputs.version, op, ...extra }).then((d) => { S = d; pushDashTax(); window.dispatchEvent(new CustomEvent("bs:data-changed", { detail: ["inputs"] })); return d; });
  // Quick marginal rates shared with the Performance / Income / Cash Flow tabs.
  function pushDashTax() {
    const t = S && S.inputs.tax; if (!t || !window.BSDash || !window.BSDash.setTax) return;
    window.BSDash.setTax({ ord: t.marginalOrdinary, qual: t.marginalQualified, state: t.stateRate, roc: t.rocPct, niit: t.niit, dedInt: t.deductMarginInterest });
  }
  let dashSaveTimer = null;
  function saveDashTax(ta) {
    if (!S) return;
    clearTimeout(dashSaveTimer);
    dashSaveTimer = setTimeout(() => save("tax", { tax: { marginalOrdinary: ta.ord, marginalQualified: ta.qual, stateRate: ta.state, rocPct: ta.roc, niit: ta.niit, deductMarginInterest: ta.dedInt } }).catch(() => {}), 1200);
  }
  // First load: redraw the Overview so accounts from the Inputs page (the IRA) are included.
  load().then(() => { if (!location.hash || location.hash === "#overview") window.dispatchEvent(new HashChangeEvent("hashchange")); }).catch(() => {});

  const propsData = () => (window.BSProps ? window.BSProps.load(true) : api("/api/properties"));

  /* ======================= INPUTS ======================= */
  let propSel = null;
  async function renderInputs(root) {
    root.replaceChildren(sheet("Inputs", "Loading…"));
    let D, L;
    try { [, D, L] = await Promise.all([load(true), propsData(), api("/api/loans").catch(() => null)]); }
    catch (e) { root.replaceChildren(sheet("Inputs", e.message)); return; }
    const I = S.inputs;
    const s = sheet("Inputs", "Every assumption the site uses, in one place: accounts, property values and loans, rents and expenses, depreciation, interest rates and tax rules. Changes save for both of you and show up on every tab.");
    s.append(h("p", { class: "note" }, I.updatedAt ? `Last change by ${who(I.updatedBy)}, ${fmtWhen(I.updatedAt)}.` : ""));
    const nav = h("div", { class: "periodbar inp-nav" }, ["Accounts", "Properties", "Loans & rates", "Taxes", "Tax law", "Change log"].map((t) => h("a", { class: "pb", href: `#inputs`, onclick: (e) => { e.preventDefault(); const el = s.querySelector(`[data-sec="${t}"]`); if (el) el.scrollIntoView({ behavior: "smooth" }); } }, t)));
    s.append(nav);
    s.append(accountsSection(root, I));
    s.append(await propertiesSection(root, D, I, L));
    s.append(loansSection(root, L, D));
    s.append(taxSection(root, I));
    s.append(paramsSection(root));
    const lg = h("details", { class: "lots", "data-sec": "Change log" }, h("summary", {}, `Change log (${(I.log || []).length})`),
      table([{ label: "When", get: (r) => fmtWhen(r.at) }, { label: "Who", get: (r) => who(r.by) }, { label: "Change", get: (r) => r.change }], (I.log || []).slice(0, 200)));
    s.append(lg);
    root.replaceChildren(s);
  }

  /* ----- accounts + Plaid ----- */
  function accountsSection(root, I) {
    const wrap = h("div", { "data-sec": "Accounts" });
    wrap.append(section("Accounts", "Accounts outside the main Schwab account (…965, which comes from the Schwab uploads). They count toward net worth on the Overview. IRA balances aren't taxed until withdrawn."));
    const rows = I.accounts.map((a) => ({ ...a }));
    const T = ["ira", "IRA"], types = [T, ["roth", "Roth IRA"], ["taxable", "Taxable brokerage"], ["bank", "Bank"], ["other", "Other"]];
    const tbl = h("table", { class: "grid dgrid" });
    tbl.append(h("thead", {}, h("tr", {}, ["Account", "Type", "Institution", "Owner", "Value", "As of", "Source", ""].map((c, i) => h("th", { class: i === 4 ? "num" : null }, c)))));
    const tb = h("tbody");
    const rowEl = (a) => {
      const n = txtIn(a.name), t = sel(types, a.type), ins = txtIn(a.institution), ow = txtIn(a.owner), v = numIn(a.value, "0.01"), d = dateIn(a.asOf);
      const saveBtn = h("button", { class: "btn-small", type: "button", onclick: async () => {
        try { await save("account", { account: { ...a, name: n.value, type: t.value, institution: ins.value, owner: ow.value, value: v.value, asOf: d.value } }); toast(root.firstChild, "Saved."); renderInputs(root); }
        catch (e) { toast(root.firstChild, e.message, "err"); } } }, a.id ? "Save" : "Add");
      const del = a.id ? h("button", { class: "link-button danger", type: "button", onclick: async () => { if (!confirm(`Remove ${a.name}?`)) return; try { await save("deleteAccount", { id: a.id }); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); } } }, "Remove") : null;
      return h("tr", {}, h("td", {}, n), h("td", {}, t), h("td", {}, ins), h("td", {}, ow), h("td", { class: "num" }, v), h("td", {}, d), h("td", {}, a.source === "plaid" ? "Plaid" : a.id ? "Manual" : ""), h("td", {}, saveBtn, " ", del));
    };
    rows.forEach((a) => tb.append(rowEl(a)));
    tb.append(rowEl({ name: "", type: "taxable", institution: "Schwab", owner: "Jen Lambert", value: null, asOf: new Date().toISOString().slice(0, 10) }));
    tbl.append(tb);
    wrap.append(h("div", { class: "sheet-scroll", tabindex: "0" }, tbl));
    wrap.append(h("p", { class: "note" }, `Total outside …965: ${usd(sum(I.accounts, (a) => a.value))}. The last row adds a new account.`));
    wrap.append(plaidPanel(root, I));
    return wrap;
  }
  function plaidPanel(root, I) {
    const box = h("div", { class: "ws-add" }, h("h3", {}, "Bank and brokerage connections (Plaid)"), h("p", { class: "note" }, "Loading…"));
    api("/api/plaid").then((P) => {
      const kids = [h("h3", {}, "Bank and brokerage connections (Plaid)")];
      if (!P.configured) {
        kids.push(h("p", { class: "note" }, "Plaid is built in but not switched on: add PLAID_SECRET (the same value vistarandall uses) to this site's Vercel project. For Schwab and other banks that sign in through their own site, also set PLAID_REDIRECT_URI to https://bluesky.website/home and add that address to the allowed redirect URIs in the Plaid dashboard."));
        box.replaceChildren(...kids); return;
      }
      kids.push(h("p", { class: "note" }, `Balances refresh on demand. Link a Plaid account to an account above and its value updates on every refresh.${P.env === "sandbox" ? " (Sandbox mode.)" : ""}`));
      const opts = [["", "— not linked —"]].concat(P.items.flatMap((it) => (it.accounts || []).map((a) => [a.id, `${it.institution} ${a.name} …${a.mask || ""}`])));
      P.items.forEach((it) => {
        kids.push(h("h4", { class: "inc-head" }, `${it.institution}`, h("span", { class: "muted small" }, ` · ${it.kind} · refreshed ${fmtWhen(it.refreshedAt)}`), it.error ? h("span", { class: "warn-text small" }, ` · ${it.error}`) : null,
          P.canManage ? h("button", { class: "link-button danger", type: "button", onclick: async () => { if (!confirm(`Disconnect ${it.institution}?`)) return; try { await api("/api/plaid", { op: "remove", itemId: it.itemId }); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); } } }, " Disconnect") : null));
        kids.push(table([
          { label: "Account", get: (a) => `${a.name} …${a.mask || ""}` }, { label: "Type", get: (a) => `${a.type}${a.subtype ? " / " + a.subtype : ""}` },
          { label: "Balance", num: 1, get: (a) => usd(a.current, 2) }, { label: "Holdings", num: 1, get: (a) => (a.holdings ? a.holdings.length : "") },
        ], it.accounts || []));
      });
      I.accounts.forEach((a) => {
        const s1 = sel(opts, a.plaidAccountId || "");
        s1.addEventListener("change", async () => { try { await api("/api/plaid", { op: "match", accountId: a.id, plaidAccountId: s1.value }); toast(root.firstChild, "Linked."); load(true); } catch (e) { toast(root.firstChild, e.message, "err"); } });
        if (P.items.length) kids.push(h("div", { class: "toolbar" }, h("span", { class: "muted" }, `${a.name}:`), s1));
      });
      const bar = h("div", { class: "toolbar" });
      if (P.canManage) ["brokerage", "bank"].forEach((kind) => bar.append(h("button", { class: "btn-small", type: "button", onclick: () => plaidLink(root, kind) }, kind === "brokerage" ? "Connect a brokerage account" : "Connect a bank account")));
      if (P.items.length) bar.append(h("button", { class: "btn-small ghost", type: "button", onclick: async () => { try { await api("/api/plaid", { op: "refresh" }); toast(root.firstChild, "Balances refreshed."); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); } } }, "Refresh balances"));
      if (!P.canManage) bar.append(h("span", { class: "note inline" }, "Matt connects and disconnects accounts."));
      kids.push(bar);
      box.replaceChildren(...kids);
    }).catch((e) => box.replaceChildren(h("h3", {}, "Bank and brokerage connections (Plaid)"), h("p", { class: "note" }, e.message)));
    return box;
  }
  function loadPlaidScript() {
    return window.Plaid ? Promise.resolve() : new Promise((res, rej) => { const sc = h("script", { src: "https://cdn.plaid.com/link/v2/stable/link-initialize.js" }); sc.onload = res; sc.onerror = () => rej(new Error("Plaid Link didn't load.")); document.head.append(sc); });
  }
  async function plaidLink(root, kind, oauth) {
    try {
      await loadPlaidScript();
      const tok = oauth ? JSON.parse(sessionStorage.getItem("bs-plaid-link") || "null") : await api("/api/plaid", { op: "linkToken", kind });
      if (!tok) return;
      try { sessionStorage.setItem("bs-plaid-link", JSON.stringify(tok)); } catch {}
      const handler = window.Plaid.create({ token: tok.linkToken, receivedRedirectUri: oauth ? location.href : undefined,
        onSuccess: async (publicToken, meta) => {
          try { await api("/api/plaid", { op: "exchange", publicToken, institution: meta.institution && meta.institution.name, kind: tok.kind }); sessionStorage.removeItem("bs-plaid-link"); if (oauth) history.replaceState(null, "", "/home#inputs"); renderInputs(root); }
          catch (e) { toast(root.firstChild, e.message, "err"); }
        },
        onExit: (err) => { if (err) toast(root.firstChild, err.display_message || err.error_message || "Plaid closed.", "err"); } });
      handler.open();
    } catch (e) { toast(root.firstChild, e.message, "err"); }
  }
  // Returning from an OAuth bank (Schwab): resume Link.
  if (/[?&]oauth_state_id=/.test(location.search)) { location.hash = "#inputs"; setTimeout(() => plaidLink(document.getElementById("report"), null, true), 1200); }

  /* ----- properties ----- */
  async function propertiesSection(root, D, I, L) {
    const wrap = h("div", { "data-sec": "Properties" });
    wrap.append(section("Properties", "Value, loan, rent roll, operating expenses, depreciation and cost segregation for each building. Rent and expense totals also update the Properties, Overview and Cash Flow tabs."));
    const ids = (D.order || Object.keys(D.properties)).filter((id) => D.properties[id].status === "active");
    if (!ids.length) { wrap.append(h("p", { class: "note" }, "No active properties.")); return wrap; }
    if (!propSel || !ids.includes(propSel)) propSel = ids[0];
    wrap.append(h("div", { class: "periodbar" }, ids.map((id) => h("button", { type: "button", class: "pb" + (id === propSel ? " on" : ""), onclick: () => { propSel = id; renderInputs(root); } }, D.properties[id].name))));
    const pid = propSel, p = D.properties[pid], b = p.building || {}, pi = JSON.parse(JSON.stringify(I.properties[pid] || {}));
    pi.rentRoll = pi.rentRoll || []; pi.expenses = pi.expenses || {}; pi.depreciation = pi.depreciation || { costSeg: {} }; pi.depreciation.costSeg = pi.depreciation.costSeg || {}; pi.sale = pi.sale || {};
    const adminLoan = L && L.loans.find((l) => (l.status || "open") === "open" && l.secures === pid && l.kind !== "margin");

    // value
    const vMethod = sel([["entered", "Entered value"], ["cap", "NOI ÷ cap rate"]], b.valuationMethod || "entered");
    const vVal = numIn(b.currentValue, "1000"), vCap = numIn(b.capRate, "0.05"), vAddr = txtIn(b.address, { placeholder: "Street, city" }), vUnits = numIn(b.units, "1"), vSf = numIn(b.squareFeet, "1");
    wrap.append(h("h4", { class: "inc-head" }, "Value"), h("div", { class: "tax-form" },
      field("Valuation method", vMethod), field("Current value $", vVal, b.valueAsOf ? `as of ${fmtDate(b.valueAsOf)}` : ""), field("Cap rate %", vCap, "Used when the method is NOI ÷ cap rate; see the Valuation tab"),
      field("Address", vAddr), field("Units", vUnits), field("Square feet", vSf)));

    // loan
    const m = p.mortgage || {};
    wrap.append(h("h4", { class: "inc-head" }, "Mortgage", m.placeholder ? h("span", { class: "ws-pill s-assigned" }, " Placeholder ") : null));
    if (adminLoan) wrap.append(h("p", { class: "note" }, `This building's loan is set up on the Admin tab ("${adminLoan.name}"); edit it under Loans & rates below. The Admin loan is used everywhere.`));
    else {
      const mA = numIn(m.amount, "1000"), mR = numIn(m.rate, "0.01"), mY = numIn(m.amortYears ?? 30, "1"), mT = numIn(m.termYears, "1"), mD = dateIn(m.loanDate), mF = dateIn(m.firstPaymentDate), mL = txtIn(m.lender);
      wrap.append(h("div", { class: "tax-form" }, field("Loan amount $", mA), field("Rate %", mR), field("Amortization (years)", mY), field("Balloon / term (years)", mT, "Blank if fully amortizing"), field("Loan date", mD), field("First payment", mF), field("Lender", mL)),
        h("div", { class: "toolbar" }, h("button", { class: "btn-small ghost", type: "button", onclick: async () => {
          try { await api("/api/properties", { version: D.version, property: pid, op: "setMortgage", mortgage: { amount: mA.value, rate: mR.value, amortYears: mY.value, termYears: mT.value, loanDate: mD.value, firstPaymentDate: mF.value, lender: mL.value, notes: "" } }); toast(root.firstChild, "Mortgage saved."); if (window.BSProps) window.BSProps.load(true); renderInputs(root); }
          catch (e) { toast(root.firstChild, e.message, "err"); } } }, "Save mortgage")));
    }
    const invPct = numIn(pi.interestInvestmentPct, "0.1");
    wrap.append(h("div", { class: "tax-form" }, field("Share of mortgage interest traced to investments %", invPct, "Refinance cash-out that went into the portfolio: that interest is investment interest (Form 4952), not a rental expense. 5100 Main starts at 30.2% ($1.51M ÷ $5.0M).")));

    // rent roll
    wrap.append(h("h4", { class: "inc-head" }, "Rent roll"));
    const rr = h("tbody");
    const rrRow = (u) => {
      const tr = h("tr", {});
      const f = { unit: txtIn(u.unit), tenant: txtIn(u.tenant), rent: numIn(u.rent, "1"), sqft: numIn(u.sqft, "1"), leaseEnd: dateIn(u.leaseEnd), increasePct: numIn(u.increasePct, "0.1") };
      const vac = h("input", { type: "checkbox", checked: !!u.vacant });
      tr._get = () => ({ id: u.id, unit: f.unit.value, tenant: f.tenant.value, rent: f.rent.value, sqft: f.sqft.value, leaseEnd: f.leaseEnd.value, increasePct: f.increasePct.value, vacant: vac.checked });
      tr.append(...Object.values(f).map((i) => h("td", {}, i)), h("td", { style: "text-align:center" }, vac), h("td", {}, h("button", { class: "link-button danger", type: "button", onclick: () => { tr.remove(); paintNoi(); } }, "×")));
      tr.addEventListener("input", paintNoi);
      return tr;
    };
    pi.rentRoll.forEach((u) => rr.append(rrRow(u)));
    const rrT = h("table", { class: "grid dgrid inp-rr" }, h("thead", {}, h("tr", {}, ["Unit", "Tenant", "Monthly rent $", "Sq ft", "Lease ends", "Annual increase %", "Vacant", ""].map((c) => h("th", {}, c)))), rr);
    wrap.append(h("div", { class: "sheet-scroll", tabindex: "0" }, rrT), h("div", { class: "toolbar" }, h("button", { class: "link-button dark", type: "button", onclick: () => { rr.append(rrRow({})); } }, "+ Add unit"),
      h("span", { class: "note inline" }, "One row per unit or lease. For a single-tenant or whole-building figure, use one row.")));

    // expenses
    const e = pi.expenses;
    const ex = { propertyTax: numIn(e.propertyTax, "1"), insurance: numIn(e.insurance, "1"), repairs: numIn(e.repairs, "1"), utilities: numIn(e.utilities, "1"), managementPct: numIn(e.managementPct, "0.1"), reserves: numIn(e.reserves, "1"), other: numIn(e.other, "1") };
    const vac = numIn(pi.vacancyPct ?? 5, "0.5"), rg = numIn(pi.rentGrowthPct ?? 3, "0.1"), eg = numIn(pi.expenseGrowthPct ?? 3, "0.1"), tg = numIn(pi.propertyTaxGrowthPct ?? 3, "0.1");
    wrap.append(h("h4", { class: "inc-head" }, "Operating expenses and growth (annual)"), h("div", { class: "tax-form" },
      field("Property tax $", ex.propertyTax), field("Insurance $", ex.insurance), field("Repairs & maintenance $", ex.repairs), field("Utilities $", ex.utilities),
      field("Management % of collected rent", ex.managementPct), field("Reserves $", ex.reserves), field("Other $", ex.other),
      field("Vacancy & credit loss %", vac), field("Rent growth % / yr", rg), field("Expense growth % / yr", eg), field("Property tax growth % / yr", tg)));
    const noiBox = h("div");
    wrap.append(noiBox);
    function collect() {
      return { ...pi, rentRoll: [...rr.children].map((tr) => tr._get()), vacancyPct: vac.value, rentGrowthPct: rg.value, expenseGrowthPct: eg.value, propertyTaxGrowthPct: tg.value,
        expenses: Object.fromEntries(Object.entries(ex).map(([k, i]) => [k, i.value])),
        depreciation: { costBasis: dep.basis.value, landPct: dep.land.value, placedInService: dep.pis.value, life: dep.life.value, priorDepreciation: dep.prior.value,
          costSeg: { done: dep.csDone.i.checked, year: dep.csYear.value, pct5: dep.p5.value, pct7: dep.p7.value, pct15: dep.p15.value, bonusPct: dep.bonus.value } },
        interestInvestmentPct: invPct.value, sale: { price: sale.price.value, sellingCostPct: sale.cost.value, exchange1031: sale.x.i.checked } };
    }
    function paintNoi() {
      const c = collect();
      const gross = sum(c.rentRoll, (u) => (u.vacant ? 0 : (num(u.rent) || 0) * 12));
      const egi = gross * (1 - (num(c.vacancyPct) || 0) / 100);
      const ee = c.expenses, opex = ["propertyTax", "insurance", "repairs", "utilities", "reserves", "other"].reduce((a, k) => a + (num(ee[k]) || 0), 0) + egi * (num(ee.managementPct) || 0) / 100;
      const noi = egi - opex, cap = num(vCap.value);
      noiBox.replaceChildren(kpis([
        { label: "Gross potential rent", value: usd(gross), sub: `${c.rentRoll.length} unit${c.rentRoll.length === 1 ? "" : "s"}` },
        { label: "Effective gross income", value: usd(egi), sub: `after ${num(c.vacancyPct) || 0}% vacancy` },
        { label: "Operating expenses", value: usd(opex), sub: egi ? `${pct((opex / egi) * 100)} of income` : "" },
        { label: "NOI", value: usd(noi), lead: true, sub: cap ? `${usd(noi / (cap / 100))} at a ${cap}% cap rate` : "" },
      ]));
    }
    Object.values(ex).concat([vac, vCap]).forEach((i) => i.addEventListener("input", paintNoi));

    // depreciation
    const d0 = pi.depreciation, cs = d0.costSeg || {};
    const dep = { basis: numIn(d0.costBasis, "1000"), land: numIn(d0.landPct ?? 20, "1"), pis: dateIn(d0.placedInService), life: sel([[27.5, "27.5 years (residential)"], [39, "39 years (commercial)"]], d0.life || 27.5), prior: numIn(d0.priorDepreciation, "1"),
      csDone: check("A cost segregation study has been done (or is planned)", cs.done), csYear: numIn(cs.year, "1"), p5: numIn(cs.pct5, "0.1"), p7: numIn(cs.pct7, "0.1"), p15: numIn(cs.pct15, "0.1"), bonus: numIn(cs.bonusPct ?? 100, "1") };
    wrap.append(h("h4", { class: "inc-head" }, "Depreciation and cost segregation"), h("div", { class: "tax-form" },
      field("Cost basis $", dep.basis, "Purchase price plus capital improvements (starts at the current value until entered)"), field("Land share %", dep.land, "Land doesn't depreciate"),
      field("Placed in service", dep.pis), field("Recovery period", dep.life), field("Depreciation taken before this year $", dep.prior, "Used for the sale estimate when the in-service date is blank"),
      dep.csDone.el, field("Study year", dep.csYear), field("5-year property % of building", dep.p5, "Carpet, appliances, fixtures"), field("7-year property %", dep.p7), field("15-year land improvements %", dep.p15, "Paving, landscaping, site lighting"),
      field("Bonus depreciation %", dep.bonus, "100% for property acquired after 1/19/2025 (P.L. 119-21); Illinois adds it back")));

    // sale
    const sale = { price: numIn(pi.sale.price, "1000"), cost: numIn(pi.sale.sellingCostPct ?? 5, "0.1"), x: check("Sell through a 1031 exchange (defers the tax)", pi.sale.exchange1031) };
    wrap.append(h("h4", { class: "inc-head" }, "Hypothetical sale (Tax Plan tab)"), h("div", { class: "tax-form" }, field("Sale price $", sale.price, "Blank = current value"), field("Selling costs %", sale.cost), sale.x.el));

    wrap.append(h("div", { class: "toolbar" }, h("button", { class: "btn-small", type: "button", onclick: async () => {
      try {
        await save("property", { property: pid, data: collect(), value: { method: vMethod.value, currentValue: vVal.value, capRate: vCap.value, address: vAddr.value, units: vUnits.value, squareFeet: vSf.value } });
        if (window.BSProps) window.BSProps.load(true);
        toast(root.firstChild, `${p.name} saved.`); renderInputs(root);
      } catch (err) { toast(root.firstChild, err.message, "err"); } } }, `Save ${p.name}`)));
    paintNoi();
    return wrap;
  }

  /* ----- loans & rates ----- */
  function loansSection(root, L, D) {
    const wrap = h("div", { "data-sec": "Loans & rates" });
    wrap.append(section("Loans & rates", L ? `Fed Funds target ${L.fed && L.fed.upper != null ? `${L.fed.lower}–${L.fed.upper}%` : "unavailable"}${L.fed && L.fed.overridden ? " (overridden on the Admin tab)" : " (live from the New York Fed)"}. Floating loans, including the Schwab margin loan, are priced as the Fed Funds upper bound plus the spread.` : "Loans couldn't be loaded."));
    if (!L) return wrap;
    const secOpts = [["", "—"], ["portfolio", "Portfolio"], ["other", "Other"]].concat((D.order || []).map((id) => [id, D.properties[id].name]));
    const kinds = [["amortizing", "Amortizing"], ["interest-only", "Interest-only"], ["margin", "Margin"], ["line", "Line of credit"]];
    const rowsEl = h("tbody");
    const row = (l) => {
      const c = (L.rows || []).find((r) => r.id === l.id) || {};
      const f = { name: txtIn(l.name), kind: sel(kinds, l.kind || "amortizing"), rateType: sel([["fixed", "Fixed"], ["floating", "Fed + spread"]], l.rateType || "fixed"), fixedRate: numIn(l.fixedRate, "0.01"), spread: numIn(l.spread, "0.01"),
        originalPrincipal: numIn(l.originalPrincipal, "1000"), amortMonths: numIn(l.amortMonths, "1"), firstPaymentDate: dateIn(l.firstPaymentDate), secures: sel(secOpts, l.secures || "") };
      const btn = h("button", { class: "btn-small", type: "button", onclick: async () => {
        const loan = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value]));
        try { await api("/api/loans", l.id ? { op: "update", id: l.id, loan } : { op: "add", loan }); toast(root.firstChild, "Loan saved."); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); }
      } }, l.id ? "Save" : "Add");
      return h("tr", {}, ...Object.values(f).map((i) => h("td", {}, i)), h("td", { class: "num" }, c.rate != null ? pct(c.rate, 2) : ""), h("td", { class: "num" }, c.balance != null ? usd(c.balance) : ""), h("td", {}, btn));
    };
    L.loans.filter((l) => (l.status || "open") === "open").forEach((l) => rowsEl.append(row(l)));
    rowsEl.append(row({ kind: "margin", rateType: "floating", spread: 0.75, secures: "portfolio", name: "" }));
    wrap.append(h("div", { class: "sheet-scroll", tabindex: "0" }, h("table", { class: "grid dgrid inp-loans" },
      h("thead", {}, h("tr", {}, ["Name", "Kind", "Rate", "Fixed %", "Spread %", "Original amount", "Amort. months", "First payment", "Secured by", "Rate now", "Balance", ""].map((x) => h("th", {}, x)))), rowsEl)));
    const placeholders = (D.order || []).filter((id) => D.properties[id].mortgage && D.properties[id].mortgage.placeholder);
    wrap.append(h("p", { class: "note" }, `The last row adds a loan (it starts as a margin loan at Fed + 0.75%; change as needed). Property mortgages entered under Properties are used when no loan here is secured by that building.${placeholders.length ? ` Placeholder mortgages in use: ${placeholders.map((id) => D.properties[id].name).join(", ")}.` : ""} Balances, closing and history are on the Admin tab.`));
    return wrap;
  }

  /* ----- tax profile ----- */
  function taxSection(root, I) {
    const t = I.tax, wrap = h("div", { "data-sec": "Taxes" });
    wrap.append(section("Taxes", "Jen's tax profile. The quick marginal rates drive the estimates on the Performance, Income and Cash Flow tabs; the Tax Plan tab runs the full calculation with the brackets and rules under Tax law."));
    const F = {};
    const n = (k, label, step, hint) => { F[k] = numIn(t[k], step); return field(label, F[k], hint); };
    const c = (k, label) => { const x = check(label, t[k]); F[k] = x.i; return x.el; };
    F.filingStatus = sel([["single", "Single"], ["mfj", "Married filing jointly"]], t.filingStatus);
    wrap.append(h("h4", { class: "inc-head" }, "Profile"), h("div", { class: "tax-form" },
      field("Filing status", F.filingStatus), n("year", "Tax year", "1"), n("birthYear", "Birth year", "1", "For IRA required distributions"),
      n("otherOrdinaryIncome", "Other ordinary income $", "100", "Wages, business income, interest elsewhere"), n("otherQualifiedDividends", "Other qualified dividends $", "100"),
      n("otherNetCapitalGain", "Other net capital gains $", "100", "Outside these accounts; losses negative"), n("iraDistributions", "IRA withdrawals this year $", "100"),
      n("otherItemized", "Other itemized deductions $", "100", "Charity, home mortgage interest"), n("otherStateLocalTax", "Other state & local taxes $", "100", "Home property tax (rental property tax is on Schedule E)")));
    wrap.append(h("h4", { class: "inc-head" }, "Portfolio income character"), h("div", { class: "tax-form" },
      n("cashDivQualifiedPct", "Qualified share of cash dividends %", "1", "Covered-call and income funds are mostly non-qualified"), n("rocPct", "Return-of-capital share of cash dividends %", "1", "Reduces basis instead of being taxed now"),
      c("deductMarginInterest", "Deduct margin interest (Form 4952)"), c("niit", "Apply the 3.8% net investment income tax")));
    wrap.append(h("h4", { class: "inc-head" }, "Rentals"), h("div", { class: "tax-form" },
      c("reps", "Jen qualifies as a real estate professional (750+ hours, material participation)"), c("activeParticipation", "Active participation (for the $25,000 allowance)"),
      c("rentalQbi", "Rentals qualify for the 20% QBI deduction (trade or business / 250-hour safe harbor)")));
    wrap.append(h("h4", { class: "inc-head" }, "Carryforwards from last year"), h("div", { class: "tax-form" },
      n("stLossCarryforward", "Short-term capital loss $", "1"), n("ltLossCarryforward", "Long-term capital loss $", "1"), n("passiveLossCarryforward", "Suspended passive losses $", "1"), n("investmentInterestCarryforward", "Investment interest $", "1")));
    wrap.append(h("h4", { class: "inc-head" }, "Quick marginal rates (other tabs)"), h("div", { class: "tax-form" },
      n("marginalOrdinary", "Federal ordinary %", "0.1"), n("marginalQualified", "Federal qualified / long-term %", "0.1"), n("stateRate", "Illinois %", "0.01")));
    wrap.append(h("div", { class: "toolbar" }, h("button", { class: "btn-small", type: "button", onclick: async () => {
      const tax = Object.fromEntries(Object.entries(F).map(([k, i]) => [k, i.type === "checkbox" ? i.checked : i.value]));
      try { await save("tax", { tax }); toast(root.firstChild, "Tax profile saved."); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); }
    } }, "Save taxes"), h("a", { href: "#taxplan", class: "link-button dark" }, "See the Tax Plan →")));
    return wrap;
  }

  /* ----- tax-law parameters ----- */
  function paramsSection(root) {
    const P = S.params, B = S.baseParams, wrap = h("div", { "data-sec": "Tax law" });
    const fs = S.inputs.tax.filingStatus === "mfj" ? "mfj" : "single";
    wrap.append(section(`Tax law, ${P.year}`, `Federal (IRS) and Illinois rules the Tax Plan uses, preloaded as of ${fmtDate(B.asOf)} and editable. Showing ${fs === "mfj" ? "married filing jointly" : "single"} thresholds (change filing status above).`));
    const inputs = [];
    const nf = (path, label, hint) => { const v = path.reduce((o, k) => o && o[k], P); const i = numIn(v, "any"); inputs.push([path, i]); return field(label, i, hint); };
    const br = P.federal.brackets[fs];
    const brIns = br.map(([lo, rate]) => [numIn(lo, "1"), numIn(rate, "0.1")]);
    wrap.append(h("h4", { class: "inc-head" }, "Federal ordinary brackets"), table([{ label: "Taxable income over", get: (r) => r[0] }, { label: "Rate %", get: (r) => r[1] }], brIns));
    wrap.append(h("h4", { class: "inc-head" }, "Federal"), h("div", { class: "tax-form" },
      nf(["federal", "standardDeduction", fs], "Standard deduction $"), nf(["federal", "ltcg", fs, 0], "0% long-term rate up to $"), nf(["federal", "ltcg", fs, 1], "15% long-term rate up to $", "20% above"),
      nf(["federal", "niit", "threshold", fs], "NIIT threshold (MAGI) $"), nf(["federal", "capitalLossLimit"], "Capital loss vs ordinary income $ / yr"), nf(["federal", "unrecaptured1250Rate"], "Unrecaptured §1250 rate %"),
      nf(["federal", "saltCap", "cap"], "SALT cap $"), nf(["federal", "saltCap", "phaseStart"], "SALT phase-down starts (MAGI) $"),
      nf(["federal", "passive", "allowance"], "Rental loss allowance $"), nf(["federal", "passive", "phaseStart"], "Allowance phase-out starts (MAGI) $"),
      nf(["federal", "qbi", "rate"], "QBI deduction %"), nf(["federal", "qbi", "threshold", fs], "QBI limit threshold $"), nf(["federal", "qbi", "phaseIn", fs], "QBI phase-in range $"),
      nf(["federal", "bonusDepreciation"], "Bonus depreciation %"), nf(["federal", "residentialLife"], "Residential life (years)"), nf(["federal", "commercialLife"], "Commercial life (years)")));
    wrap.append(h("h4", { class: "inc-head" }, "Illinois"), h("div", { class: "tax-form" },
      nf(["illinois", "rate"], "Income tax rate %"), nf(["illinois", "exemption"], "Personal exemption $"), nf(["illinois", "exemptionIncomeLimit", fs], "No exemption above AGI $")));
    wrap.append(h("p", { class: "note" }, "Illinois adds back federal bonus depreciation and allows the regular depreciation instead (Form IL-4562). Illinois has no capital gains preference and doesn't allow itemized investment interest."));
    wrap.append(h("ul", { class: "jason" }, B.sources.map((x) => h("li", {}, h("a", { href: x.url, target: "_blank", rel: "noopener" }, x.label)))));
    wrap.append(h("div", { class: "toolbar" },
      h("button", { class: "btn-small", type: "button", onclick: async () => {
        const over = JSON.parse(JSON.stringify(S.inputs.params || {}));
        const setP = (o, path, v) => { let c = o; path.slice(0, -1).forEach((k) => { c[k] = c[k] && typeof c[k] === "object" ? c[k] : (typeof path[path.indexOf(k) + 1] === "number" ? [] : {}); c = c[k]; }); c[path[path.length - 1]] = v; };
        inputs.forEach(([path, i]) => { const base = path.reduce((o, k) => o && o[k], B); const v = num(i.value); if (v != null && v !== base) { if (typeof path[path.length - 1] === "number") { const arrPath = path.slice(0, -1); const arr = (arrPath.reduce((o, k) => o && o[k], over) || arrPath.reduce((o, k) => o && o[k], P)).slice(); arr[path[path.length - 1]] = v; setP(over, arrPath, arr); } else setP(over, path, v); } });
        const nb = brIns.map(([a, b2]) => [num(a.value), num(b2.value)]);
        if (JSON.stringify(nb) !== JSON.stringify(B.federal.brackets[fs])) setP(over, ["federal", "brackets", fs], nb);
        try { await save("params", { params: over }); toast(root.firstChild, "Tax law saved."); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); }
      } }, "Save tax law"),
      h("button", { class: "link-button dark", type: "button", onclick: async () => { if (!confirm("Reset every tax-law value to the preloaded defaults?")) return; try { await save("resetParams"); renderInputs(root); } catch (e) { toast(root.firstChild, e.message, "err"); } } }, "Reset to defaults")));
    // bracket table inputs are elements; the table helper renders them via get()
    return wrap;
  }

  /* ======================= TAX PLAN ======================= */
  let annualize = (() => { try { return sessionStorage.getItem("bs-tax-ann") !== "0"; } catch { return true; } })();
  async function renderTaxPlan(root) {
    root.replaceChildren(sheet("Tax Plan", "Loading…"));
    let X;
    try { X = await api(`/api/inputs?view=tax${annualize ? "&annualize=1" : ""}`); } catch (e) { root.replaceChildren(sheet("Tax Plan", e.message)); return; }
    const s = sheet(`Tax Plan, ${X.year}`, "A full-year estimate of federal and Illinois tax on everything this site tracks: portfolio distributions and realized gains, margin interest, both buildings (rent, expenses, mortgage interest, depreciation and cost segregation), passive-loss limits, QBI and the 3.8% net investment income tax. Change any assumption on the Inputs page. A planning estimate to review with Jason, not tax advice.");
    const tog = h("div", { class: "periodbar" }, [["1", "Full-year estimate"], ["0", "Year to date only"]].map(([v, l]) => h("button", { type: "button", class: "pb" + ((annualize ? "1" : "0") === v ? " on" : ""), onclick: () => { annualize = v === "1"; try { sessionStorage.setItem("bs-tax-ann", v); } catch {} renderTaxPlan(root); } }, l)));
    s.append(tog);
    s.append(kpis([
      { label: "Estimated total tax", value: usd(X.total), sub: `federal ${usd(X.federal.total)} · NIIT ${usd(X.niit.tax)} · Illinois ${usd(X.illinois.tax)}`, lead: true },
      { label: "Adjusted gross income", value: usd(X.agi), sub: `taxable ${usd(X.taxable)}` },
      { label: "Effective rate", value: X.effective == null ? "—" : pct(X.effective * 100), sub: "total tax ÷ AGI" },
      { label: "Marginal rate, ordinary", value: pct(X.marginal.combinedOrdinary), sub: `${X.marginal.ordinary}% fed${X.marginal.niit ? " + 3.8% NIIT" : ""} + ${X.marginal.illinois}% IL` },
      { label: "Marginal rate, long-term gains", value: pct(X.marginal.combinedLtcg), sub: `${X.marginal.preferential}% fed${X.marginal.niit ? " + 3.8%" : ""} + ${X.marginal.illinois}% IL` },
    ]));
    if (X.notes.length) s.append(h("ul", { class: "jason" }, X.notes.map((n) => h("li", {}, n))));
    const line = (l, v, cls, hint) => ({ l, v, cls, hint });
    const lines = (title, rows, note) => { s.append(section(title, note)); s.append(table([{ label: "", get: (r) => (r.hint ? h("span", {}, r.l, h("span", { class: "muted small" }, ` ${r.hint}`)) : r.l) }, { label: "Amount", num: 1, get: (r) => (typeof r.v === "number" ? usd(r.v) : r.v), raw: (r) => (typeof r.v === "number" ? r.v : null) }], rows.map((r) => ({ ...r, _class: r.cls || null })))); };
    const I = X.income, Cp = X.capital;
    lines("Portfolio income (Schedule B)", [
      line("Cash dividends", I.cashDiv, null, "(character set on the 1099)"), line("  less return of capital", -I.roc), line("Non-qualified dividends", I.nonQual), line("Qualified dividends", I.qualDiv),
      line("Substitute payments in lieu", I.subst), line("Interest", I.interest), line("Capital gain distributions", I.capGainDist), line("Other ordinary income", I.otherOrdinary), line("IRA withdrawals", I.ira),
      line("Margin interest paid", -I.marginInterest, null, "(deducted below as investment interest)")]);
    lines("Capital gains and losses (Schedule D)", [
      line("Short-term realized", Cp.st), line("Long-term realized", Cp.lt), line("Capital gain distributions and other gains", Cp.netLT - Cp.lt + Cp.ltCF), line("Short-term loss carried in", -Cp.stCF), line("Long-term loss carried in", -Cp.ltCF),
      line("Net capital gain / (loss)", Cp.net, "sum"), line("Taxed at long-term rates", Cp.prefGain), line("Loss deducted against ordinary income", -Cp.lossDeduction), line("Loss carried to next year", -(Cp.carryST + Cp.carryLT), "total")]);
    s.append(section("Rentals (Schedule E)", "Rent and expenses from the rent roll and expense inputs; mortgage interest from each loan's schedule, split between rental and investment use; depreciation straight-line plus any cost segregation and bonus."));
    s.append(table([
      { label: "", get: (r) => h("strong", {}, r.name) }, { label: "Rent (after vacancy)", num: 1, get: (r) => usd(r.rent) }, { label: "Operating expenses", num: 1, get: (r) => usd(-r.opex), raw: (r) => -r.opex },
      { label: "Mortgage interest (rental)", num: 1, get: (r) => usd(-r.rentalInterest), raw: () => -1 }, { label: "Depreciation", num: 1, get: (r) => usd(-r.dep.federal), raw: () => -1 },
      { label: "Net", num: 1, get: (r) => h("strong", {}, usd(r.net)), raw: (r) => r.net }, { label: "Interest to Form 4952", num: 1, get: (r) => (r.investInterest ? usd(r.investInterest) : "—") }, { label: "Loan used", get: (r) => r.loanSrc },
    ], X.rentals));
    X.rentals.forEach((r) => { if (r.dep.bonus || r.dep.costSeg) s.append(h("p", { class: "note" }, `${r.name}: straight-line ${usd(r.dep.straightLine)}, cost-segregated MACRS ${usd(r.dep.costSeg)}, bonus ${usd(r.dep.bonus)}. Illinois allows ${usd(r.dep.illinois)}.${r.depNotes.length ? " " + r.depNotes.join(" ") : ""}`)); });
    const PA = X.passive;
    lines("Passive activity limits (Form 8582)", PA.nonpassive ? [line("Rentals treated as non-passive (real estate professional)", PA.allowed)] : [
      line("Net rental result", PA.net), line("Suspended losses carried in", -PA.priorCF), PA.allowance != null ? line("Rental loss allowance after phase-out", PA.allowance, null, "($25,000 less half of MAGI over $100,000)") : null,
      line("Allowed this year", PA.allowed, "sum"), line("Suspended, carried forward", PA.suspended, "total", "(released when the building is sold)")].filter(Boolean),
      PA.nonpassive ? null : "Without real estate professional status, rental losses (including depreciation and cost segregation) only offset passive income. Above $150,000 of MAGI the $25,000 allowance is gone.");
    const Dd = X.deductions;
    lines("Deductions", [
      line("State and local taxes", Dd.salt, null, `(capped at ${usd(Dd.saltCap)})`), line("Investment interest (Form 4952)", Dd.investmentInterest, null, `(${usd(Dd.investmentInterestTotal)} paid, limited to ${usd(Dd.nii4952)} net investment income)`),
      line("Other itemized", Dd.other), line("Itemized total", Dd.itemized, "sum"), line("Standard deduction", Dd.standard), line(Dd.itemizing ? "Itemizing" : "Taking the standard deduction", Dd.used, "total"),
      line("QBI deduction (Form 8995)", -X.qbi)]);
    const Fd = X.federal;
    lines("Federal tax", [line("Adjusted gross income", X.agi), line("Taxable income", X.taxable, "sum"), line("  taxed at ordinary rates", X.ordinaryTaxable), line("  taxed at long-term rates", X.preferential, null, `(0%: ${usd(Fd.at0)}, 15%: ${usd(Fd.at15)}, 20%: ${usd(Fd.at20)})`),
      line("Tax on ordinary income", Fd.ordinary), line("Tax on long-term gains / qualified dividends", Fd.preferential), line("Federal income tax", Fd.total, "sum"),
      line("Net investment income tax (Form 8960)", X.niit.tax, null, `(3.8% × ${usd(X.niit.base)})`), line("Federal total", Fd.total + X.niit.tax, "total")]);
    lines("Illinois (IL-1040)", [line("Federal AGI", X.agi), line("Bonus depreciation addback, net", X.illinois.addback), line("Exemption", -X.illinois.exemption), line("Illinois base income", X.illinois.base - X.illinois.exemption, "sum"), line("Illinois tax at 4.95%", X.illinois.tax, "total")]);
    const Cf = X.carryforwards;
    lines(`Carried into ${X.year + 1}`, [line("Short-term capital loss", Cf.stLoss), line("Long-term capital loss", Cf.ltLoss), line("Suspended passive losses", Cf.passive), line("Investment interest", Cf.investmentInterest)],
      "Enter these as next year's carryforwards on the Inputs page once the return is filed.");
    if (X.sales.length) {
      s.append(section("If a building were sold this year", "Gain = sale price − selling costs − adjusted basis. Cost-segregated property is recaptured at ordinary rates (§1245), straight-line depreciation at up to 25% (unrecaptured §1250), the rest at long-term rates (§1231); plus 3.8% NIIT and 4.95% Illinois. A sale also frees that building's suspended passive losses. A 1031 exchange defers all of it."));
      s.append(table([
        { label: "", get: (r) => h("strong", {}, r.name) }, { label: "Price", num: 1, get: (r) => usd(r.price) }, { label: "Adjusted basis", num: 1, get: (r) => usd(r.adjBasis) }, { label: "Gain", num: 1, get: (r) => usd(r.gain), raw: (r) => r.gain },
        { label: "§1245 recapture", num: 1, get: (r) => usd(r.rec1245) }, { label: "Unrecaptured §1250", num: 1, get: (r) => usd(r.unrec1250) }, { label: "§1231 gain", num: 1, get: (r) => usd(r.g1231) },
        { label: "Tax", num: 1, get: (r) => (r.exchange ? h("span", {}, usd(0), h("span", { class: "muted small" }, ` (${usd(r.deferred)} deferred)`)) : usd(r.tax)) },
        { label: "Mortgage payoff", num: 1, get: (r) => usd(r.mortgagePayoff) }, { label: "Net cash", num: 1, get: (r) => h("strong", {}, usd(r.netCash)) },
      ], X.sales));
    }
    if (X.rmd) s.append(h("p", { class: "note" }, `IRA: Jen is ${X.rmd.age} in ${X.year}; required minimum distributions start at ${X.rmd.startAge}.`));
    s.append(h("ul", { class: "jason" }, X.params.sources.map((x) => h("li", {}, h("a", { href: x.url, target: "_blank", rel: "noopener" }, x.label)))));
    root.replaceChildren(s);
  }

  /* ======================= VALUATION ======================= */
  let valSel = null;
  async function renderValuation(root) {
    root.replaceChildren(sheet("Valuation", "Loading…"));
    let D;
    try { [, D] = await Promise.all([load(true), propsData()]); } catch (e) { root.replaceChildren(sheet("Valuation", e.message)); return; }
    const ids = (D.order || Object.keys(D.properties)).filter((id) => D.properties[id].status === "active");
    const s = sheet("Valuation", "Cap-rate valuation: NOI from the rent roll and expenses, divided by a market cap rate. Search current cap rates for similar buildings nearby (broker surveys and sales, with sources), then apply one to set the building's value.");
    if (!ids.length) { s.append(h("p", { class: "note" }, "No active properties.")); root.replaceChildren(s); return; }
    if (!valSel || !ids.includes(valSel)) valSel = ids[0];
    s.append(h("div", { class: "periodbar" }, ids.map((id) => h("button", { type: "button", class: "pb" + (id === valSel ? " on" : ""), onclick: () => { valSel = id; renderValuation(root); } }, D.properties[id].name))));
    const pid = valSel, p = D.properties[pid], b = p.building || {}, pi = S.inputs.properties[pid] || { rentRoll: [], expenses: {} };
    const e = pi.expenses || {};
    const gross0 = sum(pi.rentRoll || [], (u) => (u.vacant ? 0 : (u.rent || 0) * 12)) || b.grossRent || 0;
    const F = { gross: numIn(Math.round(gross0), "1000"), vac: numIn(pi.vacancyPct ?? b.vacancyPct ?? 5, "0.5"), other: numIn(0, "100"),
      tax: numIn(e.propertyTax || 0, "100"), ins: numIn(e.insurance || 0, "100"), rep: numIn(e.repairs || 0, "100"), util: numIn(e.utilities || 0, "100"), mgmt: numIn(e.managementPct || 0, "0.1"), res: numIn(e.reserves || 0, "100"), oth: numIn(e.other || 0, "100"),
      cap: numIn(b.capRate || 6.5, "0.05") };
    s.append(h("div", { class: "tax-form" },
      field("Gross potential rent $ / yr", F.gross, "From the rent roll on the Inputs page"), field("Vacancy & credit loss %", F.vac), field("Other income $ / yr", F.other, "Parking, laundry, fees"),
      field("Property tax $", F.tax), field("Insurance $", F.ins), field("Repairs & maintenance $", F.rep), field("Utilities $", F.util), field("Management % of collected", F.mgmt), field("Reserves $", F.res), field("Other expenses $", F.oth),
      field("Cap rate %", F.cap)));
    const out = h("div");
    s.append(out);
    const calc = () => {
      const g = num(F.gross.value) || 0, egi = g * (1 - (num(F.vac.value) || 0) / 100) + (num(F.other.value) || 0);
      const opex = ["tax", "ins", "rep", "util", "res", "oth"].reduce((a, k) => a + (num(F[k].value) || 0), 0) + egi * (num(F.mgmt.value) || 0) / 100;
      const noi = egi - opex, cap = num(F.cap.value) || 0;
      const loan = p.mortgage ? p.mortgage.amount : null;
      const grid = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1].map((d) => cap + d).filter((c) => c > 0);
      out.replaceChildren(kpis([
        { label: "Effective gross income", value: usd(egi) }, { label: "Operating expenses", value: usd(opex), sub: egi ? `${pct((opex / egi) * 100)} expense ratio` : "" },
        { label: "NOI", value: usd(noi), lead: true }, { label: `Value at ${cap}%`, value: cap ? usd(noi / (cap / 100)) : "—", lead: true, sub: b.currentValue ? `entered value ${usd(b.currentValue)}` : "" },
        { label: "Loan to value", value: cap && loan ? pct((loan / (noi / (cap / 100))) * 100) : "—", sub: loan ? `${usd(loan)} loan${p.mortgage.placeholder ? " (placeholder)" : ""}` : "" },
      ]), table([{ label: "Cap rate", get: (r) => (r.c === cap ? h("strong", {}, pct(r.c, 2)) : pct(r.c, 2)) }, { label: "Value", num: 1, get: (r) => usd(r.v) }, { label: "Per unit", num: 1, get: (r) => (b.units ? usd(r.v / b.units) : "—") }, { label: "Per sq ft", num: 1, get: (r) => (b.squareFeet ? usd(r.v / b.squareFeet) : "—") }],
        grid.map((c) => ({ c, v: noi / (c / 100), _class: c === cap ? "sum" : null }))));
      return { noi, cap };
    };
    Object.values(F).forEach((i) => i.addEventListener("input", calc));
    calc();
    s.append(h("div", { class: "toolbar" }, h("button", { class: "btn-small", type: "button", onclick: async () => {
      const { cap } = calc();
      try { await save("property", { property: pid, data: { ...pi, vacancyPct: F.vac.value, expenses: { propertyTax: F.tax.value, insurance: F.ins.value, repairs: F.rep.value, utilities: F.util.value, managementPct: F.mgmt.value, reserves: F.res.value, other: F.oth.value } }, value: { method: "cap", capRate: cap } });
        if (window.BSProps) window.BSProps.load(true); toast(root.firstChild, `${p.name} now valued at NOI ÷ ${cap}% everywhere.`); }
      catch (err) { toast(root.firstChild, err.message, "err"); }
    } }, "Use this cap rate for the building's value"), h("span", { class: "note inline" }, "Saves the expenses and switches the valuation method to NOI ÷ cap rate. The rent roll stays on the Inputs page.")));

    // market search
    s.append(section("Market cap rates", "Searches the web for current cap rates on similar buildings in the area (broker surveys, market reports and comparable sales) and lists every source. Takes about a minute."));
    const loc = txtIn(b.address, { placeholder: "Address or town, e.g. Hinsdale, IL" }), typ = sel([["multifamily", "Multifamily"], ["mixed-use", "Mixed-use"], ["retail", "Retail"], ["office", "Office"], ["industrial", "Industrial"], ["medical office", "Medical office"]], b.propertyType === "commercial" ? "retail" : "multifamily");
    const units = numIn(b.units, "1"), notes = txtIn("", { placeholder: "Class, age, condition (optional)" });
    const res = h("div");
    const go = h("button", { class: "btn-small", type: "button", onclick: async () => {
      go.disabled = true; res.replaceChildren(h("p", { class: "note" }, "Searching… this can take a minute."));
      try { const r = await api("/api/caprates", { property: pid, location: loc.value, propertyType: typ.value, units: units.value, notes: notes.value }); paintRes(r); }
      catch (err) { res.replaceChildren(h("p", { class: "note warn-text" }, err.message)); }
      go.disabled = false;
    } }, "Search current cap rates");
    s.append(h("div", { class: "tax-form" }, field("Location", loc), field("Property type", typ), field("Units", units), field("Notes", notes)), h("div", { class: "toolbar" }, go), res);
    function paintRes(r) {
      if (!r || r.none) { res.replaceChildren(h("p", { class: "note" }, "No search yet for this building.")); return; }
      const use = (c) => h("button", { class: "link-button dark", type: "button", onclick: () => { F.cap.value = c; calc(); F.cap.scrollIntoView({ behavior: "smooth", block: "center" }); } }, `use ${c}%`);
      res.replaceChildren(
        kpis([{ label: "Low", value: pct(r.low, 2) }, { label: "Mid", value: pct(r.mid, 2), lead: true }, { label: "High", value: pct(r.high, 2) }]),
        h("div", { class: "toolbar" }, h("span", { class: "muted" }, "Apply:"), r.low ? use(r.low) : null, r.mid ? use(r.mid) : null, r.high ? use(r.high) : null),
        h("p", {}, r.summary),
        table([{ label: "Source", get: (x) => (x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener" }, x.title || x.publisher) : x.title) }, { label: "Publisher", get: (x) => x.publisher }, { label: "Date", get: (x) => x.date }, { label: "Cap rate", get: (x) => x.capRate }, { label: "Covers", get: (x) => x.scope }], r.sources || []),
        (r.comps || []).length ? h("div", {}, h("h4", { class: "inc-head" }, "Comparable sales"), table([{ label: "Property", get: (x) => (x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener" }, x.property) : x.property) }, { label: "Location", get: (x) => x.location }, { label: "Date", get: (x) => x.date }, { label: "Price", get: (x) => x.price }, { label: "Cap rate", num: 1, get: (x) => pct(x.capRate, 2) }], r.comps)) : null,
        h("p", { class: "note" }, `Searched ${fmtWhen(r.searchedAt)} by ${who(r.searchedBy)} for ${r.query.location || "the Chicago suburbs"} (${r.query.propertyType || "multifamily"}). Figures come from published sources found by AI web search; confirm before relying on them.`));
    }
    api(`/api/caprates?property=${pid}`).then(paintRes).catch(() => {});
    root.replaceChildren(s);
  }

  /* ---------- for the Overview: accounts outside …965 ---------- */
  function accountsForOverview() { return S ? S.inputs.accounts.filter((a) => a.value) : []; }

  window.BSInputs = {
    tabs: [{ slug: "inputs", name: "Inputs" }, { slug: "taxplan", name: "Tax Plan" }, { slug: "valuation", name: "Valuation" }],
    render(slug, root) { ({ inputs: renderInputs, taxplan: renderTaxPlan, valuation: renderValuation })[slug](root); },
    load, accountsForOverview, saveDashTax,
  };
})();
