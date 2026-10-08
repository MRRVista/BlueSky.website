// Properties tab, part two: profile and use mix, tagged bank accounts, tenants found from deposits,
// the To review list, leases read by AI with the lease exhibit, loans from Plaid, and the property metrics.
// Also the lease uploader shared with the AI Assistant page, and the alerts shown on the Overview.
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 1) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const num = (n, d = 0) => n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ymLabel = (ym) => `${MON[+ym.slice(5, 7) - 1]} '${ym.slice(2, 4)}`;
  const addMonths = (d, n) => { const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +(d.slice(8, 10) || 1); const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m + n, Math.min(day, last))).toISOString().slice(0, 10); };
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
  const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
  const lastMonths = (n) => { const t = today().slice(0, 7) + "-01"; return Array.from({ length: n }, (_, k) => addMonths(t, k - n + 1).slice(0, 7)); };
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const section = (title, note) => h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const input = (type, value, attrs = {}) => h("input", { type, value: value ?? "", ...attrs });
  const select = (options, value, attrs = {}) => h("select", { class: "ws-select", ...attrs }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; const opt = h("option", { value: v }, l); if (String(v) === String(value ?? "")) opt.selected = true; return opt; }));
  const kpis = (items) => h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
    h("div", { class: "kpi-label" }, k.label), h("div", { class: "kpi-value" + (k.neg ? " neg" : "") }, k.value), k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  function table(cols, rows, cls = "grid dgrid") {
    const t = h("table", { class: cls });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    const tb = h("tbody");
    rows.forEach((r) => tb.append(h("tr", { class: r._class || null }, cols.map((c) => {
      const v = c.get(r), raw = c.raw ? c.raw(r) : null;
      return h("td", { class: [c.num ? "num" : "", raw != null && raw < -0.004 ? "neg" : "", c.cls ? c.cls(r) : ""].filter(Boolean).join(" ") || null }, v);
    }))));
    t.append(tb);
    return h("div", { class: "sheet-scroll" }, t);
  }
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Something went wrong. Try again."); e.data = d.data; throw e; }
    return d;
  };
  const changed = (what) => window.dispatchEvent(new CustomEvent("bs:data-changed", { detail: what }));

  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.px-card { background: #fff; border: 1px solid #e3e9f2; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.5rem 0; }
.px-card h4 { margin: 0 0 0.35rem; font-weight: 500; color: #0c1c36; }
.px-card.sugg { border-left: 3px solid var(--gold); }
.px-card.err { border-left: 3px solid #b42318; }
.px-pill { display: inline-block; font-size: 0.72rem; padding: 0.05rem 0.5rem; border-radius: 999px; background: #eef1f6; color: #4a5b78; margin-left: 0.35rem; }
.px-pill.ok { background: #e9f3ec; color: #2e6b45; }
.px-pill.bad { background: #fdecea; color: #b42318; }
.px-pill.warn { background: #fff5cc; color: #7a5a00; }
.px-pg { font-size: 0.72rem; color: #8a99b2; margin-left: 0.3rem; }
.px-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.35rem 1.2rem; margin: 0.4rem 0; font-size: 0.9rem; }
.px-fields div span { color: #6a7a94; }
.px-mix-row { display: flex; gap: 0.5rem; align-items: center; margin: 0.25rem 0; }
.px-mix-row input { width: 5.5rem; }
.px-grid td.short { color: #b42318; }
.px-grid td.paid { color: #2e6b45; }
.px-grid td.none { color: #9aa7bb; }
.dash label.px-acct, .dash label.px-check { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0; font-size: 0.9rem; color: #263753; }
.dash input[type="checkbox"] { -webkit-appearance: checkbox; appearance: auto; width: 1rem; height: 1rem; padding: 0; margin: 0; background: #fff; border: 0; accent-color: #c9a262; flex: none; }
.px-acct.auto { background: #fff8e6; border-radius: 4px; padding: 0.15rem 0.35rem; }
.px-tl { position: relative; height: 1.2rem; background: #eef1f6; border-radius: 4px; margin: 0.2rem 0 0.5rem; }
.px-tl span { position: absolute; top: 0; bottom: 0; background: var(--gold); border-radius: 4px; }
.px-split { background: #f7f9fc; border: 1px solid #e3e9f2; border-radius: 6px; padding: 0.5rem; margin-top: 0.35rem; }
.px-split .ws-row { margin: 0.2rem 0; }
.px-up { border: 1px dashed #c9d4e3; border-radius: 8px; padding: 0.9rem 1rem; background: #fff; }
.px-up.drag { border-color: var(--gold); background: #fffaf0; }
.px-q li { margin: 0.25rem 0; }
` }));

  /* ======================= rent math ======================= */
  const activeLeases = (p, d = today()) => (p.leases || []).filter((l) => (!l.commencement || l.commencement <= d) && (!l.expiration || l.expiration >= d));
  function leaseRentOn(l, d) {
    if ((l.freeRent || []).some((f) => f.start && f.start <= d && (!f.end || f.end >= d))) return 0;
    const sched = (l.rentSchedule || []).filter((r) => r.monthly != null);
    const row = sched.find((r) => (!r.start || r.start <= d) && (!r.end || r.end >= d));
    if (row) return row.monthly;
    // after the last scheduled period (or none scheduled): the last known rent
    const past = sched.filter((r) => r.start && r.start <= d).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
    return past ? past.monthly : null;
  }
  const tenantLease = (p, tn) => (p.leases || []).find((l) => l.id === tn.leaseId || l.tenantId === tn.id) || null;
  function expectedFor(p, tn, ym) {
    const l = tenantLease(p, tn);
    const d = ym + "-15";
    if (l) {
      if ((l.commencement && d < l.commencement.slice(0, 7) + "-01") || (l.expiration && ym > l.expiration.slice(0, 7))) return 0;
      const r = leaseRentOn(l, ym + "-01");
      if (r != null) return r;
    }
    return tn.expected || 0;
  }
  const rentEntries = (p) => (p.entries || []).filter((e) => e.category === "Rent");
  function collectedFor(p, tn, ym) { return sum(rentEntries(p).filter((e) => e.tenantId === tn.id && e.date.slice(0, 7) === ym), (e) => e.amount); }
  const activeTenants = (p) => (p.tenants || []).filter((t) => t.status === "active");
  function missedRent(p, d = today()) {
    const ym = d.slice(0, 7), day = +d.slice(8, 10);
    const out = [];
    for (const tn of activeTenants(p)) {
      const exp = expectedFor(p, tn, ym);
      if (!(exp > 0)) continue;
      const got = collectedFor(p, tn, ym);
      if (day >= (tn.alertDay || 10) && got < exp * 0.97) out.push({ tenant: tn, expected: exp, collected: got });
    }
    return out;
  }
  function criticalDates(p, horizon = 365, d = today()) {
    const end = addDays(d, horizon), out = [];
    for (const l of p.leases || []) {
      const who = l.tenant || "Tenant";
      if (l.expiration && l.expiration >= d && l.expiration <= end) out.push({ date: l.expiration, kind: "Lease expires", who, lease: l });
      for (const o of l.renewalOptions || []) if (o.noticeBy && o.noticeBy >= d && o.noticeBy <= end) out.push({ date: o.noticeBy, kind: `Renewal notice due${o.term ? ` (${o.term})` : ""}`, who, lease: l });
      for (const r of l.rentSchedule || []) if (r.start && r.start > d && r.start <= end) {
        const before = leaseRentOn(l, addDays(r.start, -1));
        if (before != null && r.monthly != null && Math.abs(r.monthly - before) > 0.5) out.push({ date: r.start, kind: `Rent changes ${usd(before)} → ${usd(r.monthly)}/mo`, who, lease: l });
      }
      for (const f of l.freeRent || []) if (f.end && f.end >= d && f.end <= end) out.push({ date: addDays(f.end, 1), kind: "Free rent ends", who, lease: l });
    }
    const pr = p.profile || {};
    if (pr.appealDeadline && pr.appealDeadline >= d && pr.appealDeadline <= end) out.push({ date: pr.appealDeadline, kind: "Property tax appeal deadline", who: p.name });
    if (pr.insuranceRenewal && pr.insuranceRenewal >= d && pr.insuranceRenewal <= end) out.push({ date: pr.insuranceRenewal, kind: "Insurance renews", who: p.name });
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Everything that needs a person, across all properties (shown on the Overview).
  function alerts(data) {
    const out = [];
    if (!data) return out;
    const d = today();
    for (const id of data.order || Object.keys(data.properties)) {
      const p = data.properties[id];
      if (!p || p.status !== "active") continue;
      const go = () => { if (window.BSProps) window.BSProps.current = id; location.hash = "#properties"; };
      const rv = (p.review || []).length;
      if (rv) out.push({ level: "warn", text: `${p.name}: ${rv} transaction${rv === 1 ? "" : "s"} to review`, go });
      const sg = (p.tenants || []).filter((t) => t.status === "suggested").length;
      if (sg) out.push({ level: "info", text: `${p.name}: ${sg} possible tenant${sg === 1 ? "" : "s"} found in the deposits — confirm`, go });
      for (const m of missedRent(p, d)) out.push({ level: "bad", text: `${p.name}: ${m.tenant.name} rent ${m.collected ? `short (${usd(m.collected)} of ${usd(m.expected)})` : `not received (${usd(m.expected)} expected)`} this month`, go });
      for (const c of criticalDates(p, 365, d)) out.push({ level: c.date <= addDays(d, 90) ? "warn" : "info", date: c.date, text: `${p.name}: ${c.kind}, ${c.who}, ${fmtDate(c.date)}`, go });
      if ((p.accountsAuto || []).length) out.push({ level: "info", text: `${p.name}: ${p.accountsAuto.length} bank account${p.accountsAuto.length === 1 ? " was" : "s were"} tagged automatically — confirm`, go });
    }
    return out;
  }

  /* ======================= sections ======================= */
  // Builds every new section for one property; `run(body, okMessage)` saves through the Properties API.
  function sections(p, pid, run, PD) {
    const wrap = h("div");
    const uses = (window.BSBalance && window.BSBalance.data && window.BSBalance.data.uses) || [];
    const cats = PD.categories;
    const snapBox = h("div");
    wrap.append(attentionStrip(p), metricsSection(p, pid, snapBox), profileSection(p, run, uses), accountsSection(p, run), tenantsSection(p, run), reviewSection(p, pid, run, PD),
      leasesSection(p, pid, run, uses), loansSection(p, pid), taxSection(p, run, pid));
    return wrap;
  }

  function attentionStrip(p) {
    const items = alerts({ order: ["x"], properties: { x: p } });
    if (!items.length) return null;
    return h("ul", { class: "ov-warn" }, items.slice(0, 8).map((a) => h("li", {}, a.text.replace(`${p.name}: `, ""))));
  }

  /* ---------- profile and use mix ---------- */
  function profileSection(p, run, uses) {
    const pr = p.profile || {}, b = p.building || {};
    const sec = section("Profile", "Size and use mix drive rent per square foot, occupancy and the cap-rate search. The use mix needs to add to 100%.");
    const rentable = input("number", pr.rentableSf, { step: "1", min: "0" }), gross = input("number", pr.grossSf ?? b.squareFeet, { step: "1", min: "0" });
    const equity = input("number", pr.equityInvested, { step: "1", min: "0", placeholder: "cash put in" });
    const mixRows = h("div");
    const useOptions = [["", "Pick a use"]].concat(uses.flatMap((g) => g.t.map((t) => [t, `${g.g}: ${t}`])));
    const total = h("span", { class: "note inline" });
    const addMix = (m = {}) => {
      const s = select(useOptions, m.use || ""), v = input("number", m.pct ?? "", { step: "0.5", min: "0", max: "100", placeholder: "%" });
      const row = h("div", { class: "px-mix-row" }, s, v, h("span", {}, "%"), h("button", { type: "button", class: "link-button danger", onclick: () => { row.remove(); upd(); } }, "Remove"));
      v.addEventListener("input", upd); s.addEventListener("change", upd);
      mixRows.append(row);
    };
    function upd() { const t = sum([...mixRows.querySelectorAll("input")], (x) => Number(x.value) || 0); total.textContent = `Total ${Math.round(t * 10) / 10}%`; total.style.color = Math.abs(t - 100) < 0.5 || t === 0 ? "" : "#b42318"; }
    (pr.useMix && pr.useMix.length ? pr.useMix : [{}]).forEach(addMix); upd();
    const save = h("button", { type: "button", class: "btn-small" }, "Save profile");
    save.addEventListener("click", () => {
      const useMix = [...mixRows.children].map((r) => ({ use: r.querySelector("select").value, pct: r.querySelector("input").value })).filter((m) => m.use && Number(m.pct) > 0);
      run({ op: "setProfile", profile: { rentableSf: rentable.value, grossSf: gross.value, equityInvested: equity.value, useMix } }, "Profile saved.");
    });
    const d = h("details", { class: "ws-add", open: !(pr.useMix && pr.useMix.length) || !pr.rentableSf ? true : null },
      h("summary", {}, [pr.rentableSf ? `${num(pr.rentableSf)} rentable SF` : "Square footage not entered", (pr.useMix || []).length ? pr.useMix.map((m) => `${m.pct}% ${m.use.toLowerCase()}`).join(", ") : "use mix not entered"].join(" · ")));
    d.append(h("div", { class: "ws-row" }, field("Rentable square feet", rentable), field("Gross square feet", gross), field("Equity invested $", equity, "Cash put in, for cash-on-cash and equity multiple")),
      h("h4", { class: "inc-head" }, "Use mix"), mixRows, h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "link-button dark", onclick: () => { addMix(); upd(); } }, "+ Add a use"), total),
      h("div", { class: "ws-row-btns" }, save));
    sec.append(d);
    return sec;
  }

  /* ---------- tagged bank accounts ---------- */
  function accountsSection(p, run) {
    const sec = section("Bank accounts", "Transactions in the accounts tagged here feed this property's ledger: deposits from tenants become rent, payments become expenses, and transfers between your own accounts and loan payments are left out.");
    const bal = window.BSBalance && window.BSBalance.data;
    if (!bal) { sec.append(h("p", { class: "note" }, "Loading accounts…")); window.BSBalance && window.BSBalance.load().then(() => sec.replaceWith(accountsSection(p, run))).catch(() => {}); return sec; }
    const accts = bal.plaid.filter((a) => a.type === "depository" || a.type === "credit");
    if (!accts.length) { sec.append(h("p", { class: "note" }, "No bank accounts are connected through Plaid yet. Connect one on the Inputs tab.")); return sec; }
    const auto = new Set(p.accountsAuto || []);
    const boxes = accts.map((a) => {
      const cb = h("input", { type: "checkbox", value: a.id }); cb.checked = (p.accounts || []).includes(a.id);
      return h("label", { class: "px-acct" + (auto.has(a.id) ? " auto" : "") }, cb, ` ${a.institution} · ${a.shortName || a.name} …${a.mask} `, h("span", { class: "muted small" }, usd(a.current)), auto.has(a.id) ? h("span", { class: "px-pill warn" }, "tagged automatically") : null);
    });
    const save = h("button", { type: "button", class: "btn-small" }, "Save tags");
    save.addEventListener("click", () => run({ op: "setAccounts", accounts: boxes.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value) }, "Saved. The ledger is updating from these accounts."));
    const d = h("details", { class: "ws-add", open: auto.size ? true : null }, h("summary", {}, `${(p.accounts || []).length} account${(p.accounts || []).length === 1 ? "" : "s"} tagged${auto.size ? " (please confirm)" : ""}`));
    d.append(...boxes, h("div", { class: "ws-row-btns" }, save, auto.size ? h("button", { type: "button", class: "btn-small ghost", onclick: () => run({ op: "confirmAccounts" }, "Confirmed.") }, "Confirm as tagged") : null));
    sec.append(d);
    return sec;
  }

  /* ---------- tenants and rent ---------- */
  function tenantsSection(p, run) {
    const sec = section("Tenants and rent", "Rent is found by looking for deposits from the same payer, month after month, at the same amount or within 3%, for at least three months. Confirm each one; from then on its deposits post as rent automatically. A lease, once added, sets the expected rent.");
    const sugg = (p.tenants || []).filter((t) => t.status === "suggested");
    for (const t of sugg) {
      const name = input("text", t.name);
      sec.append(h("div", { class: "px-card sugg" }, h("h4", {}, "Possible tenant"),
        h("div", { class: "px-fields" }, h("div", {}, h("span", {}, "Payer "), t.sampleName || t.keys[0]), h("div", {}, h("span", {}, "Usual deposit "), `${usd(t.expected)} a month`),
          h("div", {}, h("span", {}, "Seen "), `${t.months} months in a row, ${t.firstSeen ? ymLabel(t.firstSeen) : ""} – ${t.lastSeen ? ymLabel(t.lastSeen) : ""}`), h("div", {}, h("span", {}, "Usually arrives "), t.day ? `around the ${ord(t.day)}` : "—")),
        h("div", { class: "ws-row" }, field("Tenant name", name)),
        h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small", onclick: () => run({ op: "tenant", id: t.id, tenant: { status: "active", name: name.value } }, "Tenant confirmed. Past deposits are posting as rent.") }, "It's rent: confirm"),
          h("button", { type: "button", class: "link-button danger", onclick: () => run({ op: "tenant", id: t.id, tenant: { status: "rejected" } }, "Noted; it won't be suggested again.") }, "Not rent"))));
    }
    const act = activeTenants(p);
    const months = lastMonths(12), d = today(), ym = d.slice(0, 7);
    if (act.length) {
      const missed = new Set(missedRent(p).map((m) => m.tenant.id));
      sec.append(table([
        { label: "Tenant", get: (t) => h("span", {}, h("strong", {}, t.name), t.suite ? h("span", { class: "muted" }, ` · ${t.suite}`) : null) },
        { label: "Lease", get: (t) => { const l = tenantLease(p, t); return l ? `to ${fmtDate(l.expiration)}` : h("span", { class: "muted" }, "none on file"); } },
        { label: "Expected / month", num: 1, get: (t) => usd(expectedFor(p, t, ym)) },
        { label: "This month", num: 1, get: (t) => usd(collectedFor(p, t, ym)) },
        { label: "Status", get: (t) => { const e = expectedFor(p, t, ym), c = collectedFor(p, t, ym); return missed.has(t.id) ? h("span", { class: "px-pill bad" }, c ? "Short" : "Missed") : c >= e * 0.97 && e > 0 ? h("span", { class: "px-pill ok" }, "Paid") : h("span", { class: "px-pill" }, `Due by the ${ord(t.alertDay || 10)}`); } },
        { label: "Last paid", get: (t) => { const e = rentEntries(p).filter((x) => x.tenantId === t.id).pop(); return e ? `${fmtDate(e.date)}, ${usd(e.amount)}` : "—"; } },
        { label: "", get: (t) => h("button", { type: "button", class: "link-button dark", onclick: (ev) => editTenant(t, ev.target.closest("tr")) }, "Edit") },
      ], act));
      // collected vs expected, last 12 months
      const grid = table([{ label: "Tenant", get: (t) => t.name }].concat(months.map((m) => ({ label: ymLabel(m), num: 1, get: (t) => { const c = collectedFor(p, t, m); return c ? usd(c) : "—"; },
        cls: (t) => { const e = expectedFor(p, t, m), c = collectedFor(p, t, m); return !e ? "none" : c >= e * 0.97 ? "paid" : m < ym || (m === ym && missed.has(t.id)) ? "short" : ""; } })))
        .concat([{ label: "12 months", num: 1, get: (t) => usd(sum(months, (m) => collectedFor(p, t, m))) }]), act, "grid dgrid px-grid");
      sec.append(h("h4", { class: "inc-head" }, "Rent collected, last 12 months"), grid,
        h("p", { class: "note" }, "Green: paid in full. Red: short or missing against the expected rent (the lease schedule, or the confirmed amount)."));
    } else if (!sugg.length) sec.append(h("p", { class: "note" }, (p.accounts || []).length ? "No recurring deposits found yet. Tenants show up here once three months of deposits from the same payer are on file, or add one below." : "Tag this property's bank account above, or add a lease, and tenants will appear here."));
    function editTenant(t, tr) {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains("px-edit")) { tr.nextElementSibling.remove(); return; }
      const name = input("text", t.name), exp = input("number", t.expected ?? "", { step: "0.01" }), day = input("number", t.alertDay || 10, { min: "1", max: "28" }), suite = input("text", t.suite || ""), payer = input("text", "", { placeholder: "e.g. ACME DENTAL" });
      const row = h("tr", { class: "px-edit" }, h("td", { colspan: "7" }, h("div", { class: "px-split" },
        h("div", { class: "ws-row" }, field("Name", name), field("Suite", suite), field("Expected rent $/mo", exp, tenantLease(p, t) ? "The lease schedule wins while it's in force" : null), field("Missed-rent alert day", day)),
        h("div", { class: "ws-row" }, field("Also match deposits from", payer, `Matching now: ${(t.keys || []).join(", ") || "nothing yet"}`)),
        h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small", onclick: () => run({ op: "tenant", id: t.id, tenant: { name: name.value, expected: exp.value, alertDay: day.value, suite: suite.value, addPayer: payer.value ? payer.value.toLowerCase().replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim() : undefined } }, "Saved.") }, "Save"),
          h("button", { type: "button", class: "link-button danger", onclick: () => { if (confirm(`Mark ${t.name} as a former tenant? Its deposits stop posting as rent automatically.`)) run({ op: "tenant", id: t.id, tenant: { status: "former" } }, "Saved."); } }, "Former tenant")))));
      tr.after(row);
    }
    // manual tenant
    const n = input("text", "", { placeholder: "Tenant name" }), e = input("number", "", { step: "0.01", placeholder: "monthly rent" }), payer = input("text", "", { placeholder: "payer as it shows on deposits (optional)" });
    const add = h("details", { class: "ws-add" }, h("summary", {}, "Add a tenant by hand"),
      h("div", { class: "ws-row" }, field("Name", n), field("Expected rent $/mo", e), field("Deposits come from", payer)),
      h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small", onclick: () => run({ op: "tenant", tenant: { name: n.value, expected: e.value, addPayer: payer.value ? payer.value.toLowerCase().replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim() : undefined } }, "Tenant added.") }, "Add tenant")));
    sec.append(add);
    return sec;
  }

  /* ---------- To review ---------- */
  function reviewSection(p, pid, run, PD) {
    const items = p.review || [];
    const sec = section(`To review${items.length ? ` (${items.length})` : ""}`, "Plaid transactions from the tagged accounts that need a category. Tick \"Remember\" and that payee posts on its own from then on. Split a transaction across categories or properties when it covers more than one.");
    if (!items.length) { sec.append(h("p", { class: "note" }, (p.accounts || []).length ? "Nothing waiting." : "Nothing waiting. Tag a bank account above to start the feed.")); return sec; }
    const cats = PD.categories.map((c) => c.name);
    const tenants = (p.tenants || []).filter((t) => t.status === "active" || t.status === "suggested");
    const acctName = (id) => { const a = window.BSBalance && window.BSBalance.data && window.BSBalance.data.plaid.find((x) => x.id === id); return a ? `${a.shortName || a.name} …${a.mask}` : ""; };
    const remAll = h("input", { type: "checkbox" }); remAll.checked = true;
    const bulk = h("button", { type: "button", class: "btn-small" }, `Post all ${items.length} as suggested`);
    bulk.addEventListener("click", () => { if (confirm(`Post all ${items.length} with the suggested categories?`)) run({ op: "review", items: items.map((r) => ({ txId: r.txId, action: "post", category: r.suggested.category, tenantId: r.suggested.tenantId, remember: remAll.checked })) }, "Posted."); });
    sec.append(h("div", { class: "ws-row-btns" }, bulk, h("label", { class: "px-check" }, remAll, "Remember these payees")));
    const shown = items.slice(0, 150);
    const t = table([
      { label: "Date", get: (r) => fmtDate(r.date) },
      { label: "Payee", get: (r) => h("span", {}, r.name, h("span", { class: "muted small" }, ` ${acctName(r.acct)}`)) },
      { label: "Amount", num: 1, get: (r) => usd(r.amount, 2), raw: (r) => r.amount },
      { label: "Category", get: (r) => { const s = select(cats, r.suggested.category, { "data-tx": r.txId }); s.title = r.suggested.reason || ""; return h("span", {}, s, h("span", { class: "muted small" }, ` ${r.suggested.reason || ""}`)); } },
      { label: "Remember", get: (r) => { const c = h("input", { type: "checkbox", "data-rem": r.txId, "aria-label": `Remember ${r.name}` }); return c; } },
      { label: "", get: (r) => h("span", { class: "ws-actions" },
        h("button", { type: "button", class: "link-button dark", onclick: (ev) => post(r, ev) }, "Post"), " ",
        h("button", { type: "button", class: "link-button dark", onclick: (ev) => split(r, ev.target.closest("tr")) }, "Split"), " ",
        h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "review", txId: r.txId, action: "transfer" }, "Marked as a transfer.") }, "Transfer"), " ",
        h("button", { type: "button", class: "link-button danger", onclick: (ev) => run({ op: "review", txId: r.txId, action: "ignore", remember: ev.target.closest("tr").querySelector(`[data-rem]`).checked }, "Ignored.") }, "Ignore")) },
    ], shown);
    function post(r, ev) {
      const tr = ev.target.closest("tr");
      const cat = tr.querySelector("[data-tx]").value;
      let tenantId = r.suggested.tenantId;
      if (cat === "Rent" && !tenantId && tenants.length === 1) tenantId = tenants[0].id;
      run({ op: "review", txId: r.txId, action: "post", category: cat, tenantId, remember: tr.querySelector("[data-rem]").checked }, "Posted.");
    }
    function split(r, tr) {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains("px-edit")) { tr.nextElementSibling.remove(); return; }
      const ids = (PD.order || Object.keys(PD.properties)).filter((id) => PD.properties[id].status === "active");
      const lines = h("div");
      const addLine = (amt) => lines.append(h("div", { class: "ws-row" }, select(ids.map((id) => [id, PD.properties[id].name]), pid), select(cats, r.suggested.category), input("number", amt ?? "", { step: "0.01", placeholder: "amount" })));
      addLine(Math.abs(r.amount)); addLine("");
      const row = h("tr", { class: "px-edit" }, h("td", { colspan: "6" }, h("div", { class: "px-split" }, h("p", { class: "note" }, `Split ${usd(Math.abs(r.amount), 2)} across properties or categories. The parts must add up to the total.`), lines,
        h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "link-button dark", onclick: () => addLine("") }, "+ Add a line"),
          h("button", { type: "button", class: "btn-small", onclick: () => {
            const splits = [...lines.children].map((l) => { const [ps, cs, a] = l.querySelectorAll("select, input"); return { property: ps.value, category: cs.value, amount: a.value }; }).filter((x) => Number(x.amount) > 0);
            run({ op: "review", txId: r.txId, action: "post", splits }, "Split and posted.");
          } }, "Post split")))));
      tr.after(row);
    }
    sec.append(t);
    if (items.length > shown.length) sec.append(h("p", { class: "note" }, `Showing the newest ${shown.length}; post or ignore these to see the rest.`));
    return sec;
  }

  /* ---------- leases and the lease exhibit ---------- */
  function leasesSection(p, pid, run, uses) {
    const sec = section("Leases", "Upload lease PDFs (several at once is fine, amendments too). Each is read by AI and shown for you to check, with the page each figure came from, before anything is saved. The PDFs are filed in Documents under Property & leases.");
    sec.append(leaseUploader({ propertyId: pid, compact: true }));
    const leases = p.leases || [];
    if (leases.length) {
      sec.append(table([
        { label: "Tenant", get: (l) => h("span", {}, h("strong", {}, l.tenant || "—"), l.suite ? h("span", { class: "muted" }, ` · ${l.suite}`) : null) },
        { label: "SF", num: 1, get: (l) => num(l.sf) },
        { label: "Use", get: (l) => l.useType || "—" },
        { label: "Type", get: (l) => ({ gross: "Gross", modified_gross: "Modified gross", nnn: "NNN", other: "Other" })[l.leaseType] || "—" },
        { label: "Term", get: (l) => `${fmtDate(l.commencement)} – ${fmtDate(l.expiration)}` },
        { label: "Rent now", num: 1, get: (l) => usd(leaseRentOn(l, today())) },
        { label: "Amendments", num: 1, get: (l) => String((l.amendments || []).length) },
        { label: "", get: (l) => h("span", { class: "ws-actions" },
          h("button", { type: "button", class: "link-button dark", onclick: (ev) => leaseDetail(l, ev.target.closest("tr")) }, "Details"), " ",
          h("button", { type: "button", class: "link-button danger", onclick: () => { if (confirm(`Remove the lease for ${l.tenant}? The PDF stays in Documents.`)) run({ op: "deleteLease", id: l.id }, "Lease removed."); } }, "Remove")) },
      ], leases));
      sec.append(exhibit(p));
    }
    function leaseDetail(l, tr) {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains("px-edit")) { tr.nextElementSibling.remove(); return; }
      const f = leaseEditor(l, uses);
      const row = h("tr", { class: "px-edit" }, h("td", { colspan: "8" }, h("div", { class: "px-split" }, leaseFacts(l), f.el,
        h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small", onclick: () => run({ op: "updateLease", id: l.id, lease: f.value() }, "Lease saved.") }, "Save changes"),
          (l.docIds || []).map((id) => h("a", { class: "dark-link", href: `/api/docs?dl=${encodeURIComponent(id)}`, target: "_blank", rel: "noopener" }, "Open the PDF")),
          (l.amendments || []).map((a) => h("span", { class: "note inline" }, ` · Amendment: ${a.summary}`))))));
      tr.after(row);
    }
    return sec;
  }

  function leaseFacts(l) {
    const pg = (k) => (l.pages && l.pages[k] ? h("span", { class: "px-pg" }, `p. ${l.pages[k]}`) : null);
    const lt = { gross: "Gross", modified_gross: "Modified gross", nnn: "Triple net (NNN)", other: "Other" };
    const esc = l.escalation ? (l.escalation.type === "fixed_pct" ? `${l.escalation.pct}% a year` : l.escalation.type === "cpi" ? "CPI" : l.escalation.type === "none" ? "None" : "") + (l.escalation.note ? ` (${l.escalation.note})` : "") : "—";
    const rows = [
      ["Tenant", l.tenant, "tenant"], ["Guarantor", l.guarantor, "guarantor"], ["Suite", l.suite, "suite"], ["Leased SF", num(l.sf), "leased_sf"], ["Use", l.useType, "use_type"], ["Permitted use", l.permittedUse, "permitted_use"],
      ["Commencement", fmtDate(l.commencement), "commencement"], ["Rent starts", fmtDate(l.rentStart), "rent_start"], ["Expiration", fmtDate(l.expiration), "expiration"],
      ["Lease type", lt[l.leaseType] || "—", "lease_type"], ["Tenant reimburses", (l.reimbursements || []).join(", ") || "—", "reimbursements"], ["Escalations", esc, "escalation"],
      ["Security deposit", usd(l.securityDeposit), "security_deposit"], ["Renewal options", (l.renewalOptions || []).map((o) => `${o.term || "option"}${o.noticeBy ? `, notice by ${fmtDate(o.noticeBy)}` : o.notice ? `, ${o.notice}` : ""}`).join("; ") || "—", "renewal_options"],
      ["Termination", l.termination || "—", "termination_rights"], ["Expansion", l.expansion || "—", "expansion_rights"], ["Exclusives", l.exclusives || "—", "exclusives"], ["Notes", l.notes || "—", "notes"],
    ];
    const box = h("div");
    box.append(h("div", { class: "px-fields" }, rows.map(([k, v, pk]) => h("div", {}, h("span", {}, `${k}: `), v || "—", pg(pk)))));
    if ((l.rentSchedule || []).length) box.append(table([
      { label: "From", get: (r) => fmtDate(r.start) }, { label: "To", get: (r) => fmtDate(r.end) },
      { label: "Monthly", num: 1, get: (r) => usd(r.monthly, 2) }, { label: "Annual", num: 1, get: (r) => usd(r.monthly != null ? r.monthly * 12 : null) }, { label: "$/SF/yr", num: 1, get: (r) => (r.annualPsf != null ? `$${r.annualPsf.toFixed(2)}` : l.sf && r.monthly ? `$${(r.monthly * 12 / l.sf).toFixed(2)}` : "—") },
    ], l.rentSchedule));
    return box;
  }
  function leaseEditor(l, uses) {
    const f = {
      tenant: input("text", l.tenant), suite: input("text", l.suite), sf: input("number", l.sf, { step: "1" }),
      useType: select([["", "—"]].concat(uses.flatMap((g) => g.t.map((t) => [t, t]))), l.useType || ""),
      commencement: input("date", l.commencement), expiration: input("date", l.expiration),
      leaseType: select([["", "—"], ["gross", "Gross"], ["modified_gross", "Modified gross"], ["nnn", "NNN"], ["other", "Other"]], l.leaseType || ""),
      securityDeposit: input("number", l.securityDeposit, { step: "0.01" }),
    };
    return {
      el: h("div", {}, h("div", { class: "ws-row" }, field("Tenant", f.tenant), field("Suite", f.suite), field("Leased SF", f.sf), field("Use", f.useType)),
        h("div", { class: "ws-row" }, field("Commencement", f.commencement), field("Expiration", f.expiration), field("Lease type", f.leaseType), field("Security deposit $", f.securityDeposit))),
      value: () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value || null])),
    };
  }

  // Rent roll, expiration schedule and critical dates.
  function exhibit(p) {
    const d = today();
    const leases = (p.leases || []).slice().sort((a, b) => ((a.expiration || "9") < (b.expiration || "9") ? -1 : 1));
    const pr = p.profile || {};
    const rentable = pr.rentableSf || (p.building || {}).squareFeet || null;
    const wrap = h("div");
    wrap.append(h("h4", { class: "inc-head" }, "Lease exhibit"));
    const roll = leases.map((l) => { const m = leaseRentOn(l, d) || 0; return { l, monthly: m, annual: m * 12, psf: l.sf ? (m * 12) / l.sf : null, remaining: l.expiration ? Math.max(yearsBetween(d, l.expiration), 0) : null, active: activeLeases(p, d).includes(l) }; });
    const totAnnual = sum(roll.filter((r) => r.active), (r) => r.annual), totSf = sum(roll.filter((r) => r.active), (r) => r.l.sf);
    wrap.append(h("p", { class: "note" }, `Rent roll as of ${fmtDate(d)}.`), table([
      { label: "Tenant", get: (r) => h("span", {}, r.l.tenant || "—", r.active ? null : h("span", { class: "px-pill" }, r.l.expiration && r.l.expiration < d ? "expired" : "not started")) },
      { label: "Suite", get: (r) => r.l.suite || "—" },
      { label: "SF", num: 1, get: (r) => num(r.l.sf) },
      { label: "Share of SF", num: 1, get: (r) => (rentable && r.l.sf ? pct(r.l.sf / rentable) : "—") },
      { label: "Rent / month", num: 1, get: (r) => usd(r.monthly) },
      { label: "Rent / year", num: 1, get: (r) => usd(r.annual) },
      { label: "$/SF/yr", num: 1, get: (r) => (r.psf != null ? `$${r.psf.toFixed(2)}` : "—") },
      { label: "Type", get: (r) => ({ gross: "Gross", modified_gross: "Mod. gross", nnn: "NNN", other: "Other" })[r.l.leaseType] || "—" },
      { label: "Expires", get: (r) => fmtDate(r.l.expiration) },
      { label: "Years left", num: 1, get: (r) => (r.remaining != null ? r.remaining.toFixed(1) : "—") },
    ], roll.concat([{ _class: "sum", l: { tenant: "Total in force", sf: totSf }, monthly: totAnnual / 12, annual: totAnnual, psf: totSf ? totAnnual / totSf : null, remaining: null, active: true }])));
    // expiration schedule by year
    const byYear = {};
    roll.filter((r) => r.active && r.l.expiration).forEach((r) => { const y = r.l.expiration.slice(0, 4); const b = (byYear[y] = byYear[y] || { year: y, sf: 0, rent: 0, n: 0 }); b.sf += r.l.sf || 0; b.rent += r.annual; b.n++; });
    const ys = Object.values(byYear).sort((a, b) => (a.year < b.year ? -1 : 1));
    if (ys.length) {
      wrap.append(h("h4", { class: "inc-head" }, "Expiration schedule"), table([
        { label: "Year", get: (r) => r.year }, { label: "Leases", num: 1, get: (r) => String(r.n) },
        { label: "SF expiring", num: 1, get: (r) => num(r.sf) }, { label: "Share of SF", num: 1, get: (r) => (rentable ? pct(r.sf / rentable) : "—") },
        { label: "Rent expiring / yr", num: 1, get: (r) => usd(r.rent) }, { label: "Share of rent", num: 1, get: (r) => (totAnnual ? pct(r.rent / totAnnual) : "—") },
        { label: "", get: (r) => h("div", { class: "px-tl", style: "width:10rem" }, h("span", { style: `left:0;width:${totAnnual ? Math.max(2, (r.rent / totAnnual) * 100) : 0}%` })) },
      ], ys));
    }
    const cd = criticalDates(p, 730, d);
    wrap.append(h("h4", { class: "inc-head" }, "Critical dates, next 24 months"), cd.length ? table([
      { label: "Date", get: (c) => fmtDate(c.date) }, { label: "What", get: (c) => c.kind }, { label: "Tenant", get: (c) => c.who },
      { label: "In", num: 1, get: (c) => { const n = Math.round((Date.parse(c.date) - Date.parse(d)) / 864e5); return h("span", { class: n <= 90 ? "px-pill warn" : "px-pill" }, `${n} days`); } },
    ], cd) : h("p", { class: "note" }, "Nothing in the next 24 months."));
    wrap.append(h("div", { class: "ws-row-btns" },
      h("button", { type: "button", class: "btn-small", onclick: () => exhibitXlsx(p, roll, ys, cd).catch((e) => alert(e.message)) }, "Export to Excel"),
      h("button", { type: "button", class: "btn-small ghost", onclick: () => exhibitPrint(p, wrap) }, "Print / save as PDF")));
    return wrap;
  }
  let xlsx = null;
  const loadXlsx = () => xlsx || (xlsx = new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => res(window.XLSX); s.onerror = () => { xlsx = null; rej(new Error("The spreadsheet library didn't load. Try again.")); }; document.head.append(s); }));
  async function exhibitXlsx(p, roll, ys, cd) {
    const X = await loadXlsx();
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Tenant", "Suite", "SF", "Rent/month", "Rent/year", "$/SF/yr", "Lease type", "Commencement", "Expiration", "Years left", "Use", "Security deposit"]]
      .concat(roll.map((r) => [r.l.tenant || "", r.l.suite || "", r.l.sf ?? "", +r.monthly.toFixed(2), +r.annual.toFixed(2), r.psf != null ? +r.psf.toFixed(2) : "", r.l.leaseType || "", r.l.commencement || "", r.l.expiration || "", r.remaining != null ? +r.remaining.toFixed(2) : "", r.l.useType || "", r.l.securityDeposit ?? ""]))), "Rent roll");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Year", "Leases", "SF expiring", "Rent expiring/yr"]].concat(ys.map((y) => [y.year, y.n, y.sf, +y.rent.toFixed(2)]))), "Expirations");
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Date", "What", "Tenant"]].concat(cd.map((c) => [c.date, c.kind, c.who]))), "Critical dates");
    X.writeFile(wb, `${p.name.replace(/\W+/g, "_")}_lease_exhibit_${today()}.xlsx`);
  }
  function exhibitPrint(p, node) {
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups for this site to print the exhibit."); return; }
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button").forEach((b) => b.remove());
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} lease exhibit</title><style>body{font:13px/1.4 system-ui,sans-serif;color:#0c1c36;margin:24px}h1{font-size:18px;margin:0 0 4px}h4{margin:18px 0 6px;font-size:14px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dde4ee;padding:4px 6px;text-align:left}th.num,td.num{text-align:right}tr.sum td{font-weight:600}.px-tl{display:none}.px-pill{font-size:11px;color:#555}.note{color:#555}</style></head><body><h1>${esc(p.name)}: lease exhibit</h1>${clone.innerHTML}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  /* ---------- loans ---------- */
  function loansSection(p, pid) {
    const sec = section("Loans", "Loans linked to this property on the Overview. Where Plaid's lender data covers the loan, its rate, payments and dates fill in here; otherwise the terms on the Admin tab (or the mortgage below) are used and Plaid keeps the balance current.");
    const body = h("div", {}, h("p", { class: "note" }, "Loading…"));
    sec.append(body);
    if (!window.BSWealthModel || !window.BSWealthModel.snapshot) { body.replaceChildren(h("p", { class: "note" }, "Open the Overview once to load the loan figures.")); return sec; }
    window.BSWealthModel.snapshot().then(({ M }) => {
      const debts = M.debts.filter((d) => d.secures === pid);
      if (!debts.length) { body.replaceChildren(h("p", { class: "note" }, "No loan is linked to this property. Link one on the Overview's balance sheet.")); return; }
      const B = window.BSBalance && window.BSBalance.data;
      const plaidFor = (d) => { const r = B && B.balance.rows[d.key]; return r && r.plaidAccountId ? B.plaid.find((a) => a.id === r.plaidAccountId) : null; };
      body.replaceChildren(...debts.map((d) => {
        const a = plaidFor(d), L = (a && a.liability) || {};
        const rows = [
          ["Balance", usd(d.balance), a ? `Plaid ${a.institution} …${a.mask}` : d.source],
          ["Rate", d.rate != null ? `${d.rate.toFixed(3)}%${d.floating ? " floating" : " fixed"}` : "—", L.rateType ? `Plaid: ${L.rateType}` : ""],
          ["Payment", d.payment ? usd(d.payment, 2) : L.nextPayment ? usd(L.nextPayment, 2) : "—", "principal and interest"],
          ["Next payment", d.next ? fmtDate(d.next) : L.nextDue ? fmtDate(L.nextDue) : "—", ""],
          ["Maturity", d.maturity ? fmtDate(d.maturity) : L.maturity ? fmtDate(L.maturity) : "—", d.left ? `${d.left} payments left` : ""],
          ["Balloon at maturity", d.balloon ? usd(d.balloon) : "—", d.balloon ? "what's left to repay or refinance" : ""],
          ["Interest, next 12 months (est.)", usd(d.rate ? d.balance * d.rate / 100 : null), "on today's balance"],
        ];
        if (d.payment && d.rate != null) {
          const int = d.balance * d.rate / 1200, esc = d.escrow || 0;
          rows.push(["Next payment split (est.)", `${usd(int, 2)} interest · ${usd(d.payment - int, 2)} principal${esc ? ` · ${usd(esc, 2)} escrow` : ""}`, "from the balance and rate"]);
        }
        if (L.originationAmount) rows.push(["Original loan", usd(L.originationAmount), L.originationDate ? fmtDate(L.originationDate) : ""]);
        if (L.escrowBalance != null) rows.push(["Escrow balance", usd(L.escrowBalance, 2), "Plaid"]);
        if (L.ytdInterest != null) rows.push(["Interest paid this year", usd(L.ytdInterest, 2), "Plaid"]);
        if (L.lastPayment) rows.push(["Last payment", `${usd(L.lastPayment, 2)} on ${fmtDate(L.lastPaid)}`, "Plaid"]);
        if (a && !a.liability) rows.push(["Lender detail", "Balance only", "Plaid doesn't report terms for this loan; terms come from the Admin tab or the mortgage below"]);
        return h("div", { class: "px-card" }, h("h4", {}, d.name, d.lender ? h("span", { class: "muted" }, ` · ${d.lender}`) : null),
          table([{ label: "", get: (r) => r[0] }, { label: "", num: 1, get: (r) => r[1] }, { label: "", get: (r) => h("span", { class: "muted small" }, r[2]) }], rows));
      }));
    }).catch((e) => body.replaceChildren(h("p", { class: "note" }, e.message)));
    return sec;
  }

  /* ---------- metrics ---------- */
  function metricsSection(p, pid, holder) {
    const sec = section("Property metrics");
    const body = h("div", {}, h("p", { class: "note" }, "Working out the metrics…"));
    sec.append(body);
    if (!window.BSWealthModel || !window.BSWealthModel.snapshot) { body.replaceChildren(h("p", { class: "note" }, "Open the Overview once to load the metrics.")); return sec; }
    window.BSWealthModel.snapshot().then(({ M, Y1 }) => {
      const pv = M.props.find((x) => x.id === pid);
      if (!pv) { body.replaceChildren(h("p", { class: "note" }, "This property isn't on the balance sheet.")); return; }
      const d = today(), pr = p.profile || {};
      const rentable = pr.rentableSf || null;
      const act = activeLeases(p, d);
      const leasedSf = sum(act, (l) => l.sf);
      const curAnnual = sum(act, (l) => (leaseRentOn(l, d) || 0) * 12);
      const tenantsAnnual = sum(activeTenants(p).filter((t) => !tenantLease(p, t)), (t) => (t.expected || 0) * 12);
      const contractAnnual = curAnnual + tenantsAnnual;
      const months = lastMonths(13).slice(0, 12); // the 12 full months before this one
      const expected12 = sum(activeTenants(p), (t) => sum(months, (m) => expectedFor(p, t, m)));
      const collected12 = sum(activeTenants(p), (t) => sum(months, (m) => collectedFor(p, t, m)));
      const rentAll12 = sum(rentEntries(p).filter((e) => months.includes(e.date.slice(0, 7))), (e) => e.amount);
      const T12 = pv.t12 || {};
      const income12 = T12.rent || 0, opex12 = T12.costs || 0;
      const noi = pv.noi;
      const annualizedNoi = contractAnnual ? contractAnnual + Math.max(income12 - rentAll12, 0) - opex12 : null;
      const debts = M.debts.filter((x) => x.secures === pid);
      const debt = sum(debts, (x) => x.balance);
      const c = Y1.cols[pid] || { interest: 0, principal: 0 };
      const ds = c.interest + c.principal;
      const V = pv.value;
      const equityNow = V != null ? V - debt : null;
      const eqIn = pr.equityInvested || null;
      const cfAfter = noi - ds;
      // WALT and concentration
      const withRent = act.map((l) => ({ l, annual: (leaseRentOn(l, d) || 0) * 12, yrs: l.expiration ? Math.max(yearsBetween(d, l.expiration), 0) : 0 }));
      const walt = sum(withRent, (x) => x.annual) ? sum(withRent, (x) => x.annual * x.yrs) / sum(withRent, (x) => x.annual) : null;
      const waltSf = sum(withRent, (x) => x.l.sf) ? sum(withRent, (x) => (x.l.sf || 0) * x.yrs) / sum(withRent, (x) => x.l.sf) : null;
      const allRents = withRent.map((x) => ({ name: x.l.tenant, a: x.annual })).concat(activeTenants(p).filter((t) => !tenantLease(p, t)).map((t) => ({ name: t.name, a: (t.expected || 0) * 12 })));
      const top = allRents.sort((a, b) => b.a - a.a)[0];
      const byUse = {};
      act.forEach((l) => { const u = l.useType || "Unclassified"; const b = (byUse[u] = byUse[u] || { sf: 0, a: 0 }); b.sf += l.sf || 0; b.a += (leaseRentOn(l, d) || 0) * 12; });
      // distributions since purchase (ledger net less debt service at today's pace), for the equity multiple
      const since = (p.building || {}).purchaseDate;
      const ledgerSince = since ? window.BSProps.between(pid, since, d) : null;
      const monthsHeld = since ? Math.max(0, yearsBetween(since, d) * 12) : 0;
      const dist = ledgerSince ? ledgerSince.rent - ledgerSince.costs - (ds / 12) * monthsHeld : null;
      const floating = debts.some((x) => x.floating);
      const maturity = debts.map((x) => x.maturity).filter(Boolean).sort()[0];
      body.replaceChildren(
        kpis([
          { label: "Value", value: usd(V), sub: pv.valueBasis, lead: true },
          { label: "Net operating income", value: usd(noi), sub: pv.src === "proforma" ? "pro forma" : "last 12 months" },
          { label: "Occupancy", value: rentable && leasedSf ? pct(leasedSf / rentable) : "—", sub: rentable ? `${num(leasedSf)} of ${num(rentable)} SF leased` : "add rentable SF and leases" },
          { label: "DSCR", value: ds ? `${(noi / ds).toFixed(2)}×` : "—", sub: ds ? `${usd(ds)} debt service, next 12 months` : "no debt" },
          { label: "WALT", value: walt != null ? `${walt.toFixed(1)} yrs` : "—", sub: "rent-weighted lease term left" },
        ]),
        h("h4", { class: "inc-head" }, "Performance"),
        mtable([
          ["Physical occupancy", rentable && leasedSf ? pct(leasedSf / rentable) : "—", "leased SF ÷ rentable SF (leases in force)"],
          ["Economic occupancy", expected12 ? pct(collected12 / expected12) : "—", "rent collected ÷ rent due, last 12 full months"],
          ["Rent per SF per year", leasedSf ? `$${(curAnnual / leasedSf).toFixed(2)}` : "—", "leases in force"],
          ...Object.entries(byUse).map(([u, b]) => [`  ${u}`, b.sf ? `$${(b.a / b.sf).toFixed(2)} / SF` : "—", `${num(b.sf)} SF`]),
          ["NOI, last 12 months", usd(noi), pv.src === "proforma" ? "pro forma until a year of rent is on file" : "ledger"],
          ["NOI, annualized at today's rents", usd(annualizedNoi), "contract rent now × 12 + other income − last 12 months' expenses"],
          ["Operating expense ratio", income12 ? pct(opex12 / income12) : "—", "expenses ÷ income, last 12 months"],
          ["Operating expenses per SF", rentable ? `$${(opex12 / rentable).toFixed(2)}` : "—", "last 12 months ÷ rentable SF"],
          ["WALT", walt != null ? `${walt.toFixed(1)} years` : "—", waltSf != null ? `${waltSf.toFixed(1)} years weighted by SF` : ""],
          ["Largest tenant", top && contractAnnual ? `${pct(top.a / contractAnnual)} of rent` : "—", top ? top.name : ""],
        ]),
        h("h4", { class: "inc-head" }, "Debt"),
        mtable([
          ["Loan balance", usd(debt), debts.map((x) => x.name).join(", ") || "none linked"],
          ["Loan to value", V && debt ? pct(debt / V) : "—", ""],
          ["DSCR", ds ? `${(noi / ds).toFixed(2)}×` : "—", "NOI ÷ principal and interest; lenders usually want 1.25×+"],
          ["Debt yield", debt ? pct(noi / debt, 2) : "—", "NOI ÷ loan balance; lenders look for 8–10%+"],
          ["Rate type", debts.length ? (floating ? "Floating" : "Fixed") : "—", debts.map((x) => `${x.rate != null ? x.rate.toFixed(2) : "?"}%`).join(", ")],
          ["Maturity / reset", maturity ? fmtDate(maturity) : pr.rateResetDate ? fmtDate(pr.rateResetDate) : "—", maturity ? `${Math.round(yearsBetween(d, maturity) * 10) / 10} years away` : ""],
          ["Covenants", pr.covenants || "—", "entered below"],
        ]),
        h("h4", { class: "inc-head" }, "Returns"),
        mtable([
          ["Cap rate on value", V ? pct(noi / V, 2) : "—", pv.cap ? `market rate ${(pv.cap * 100).toFixed(2)}%` : ""],
          ["Cash flow after debt service", usd(cfAfter), "NOI − principal and interest, next 12 months"],
          ["Cash-on-cash return", eqIn ? pct(cfAfter / eqIn) : equityNow > 0 ? pct(cfAfter / equityNow) : "—", eqIn ? "on equity invested" : "on today's equity (enter equity invested above for cash put in)"],
          ["Equity multiple", eqIn && equityNow != null ? `${((equityNow + (dist || 0)) / eqIn).toFixed(2)}×` : "—", eqIn ? `(today's equity ${usd(equityNow)} + cash out since purchase ${usd(dist)}) ÷ ${usd(eqIn)} put in` : "enter equity invested above"],
          ["Purchase price", usd((p.building || {}).purchasePrice), (p.building || {}).purchaseDate ? fmtDate(p.building.purchaseDate) : "add it in Building details"],
          ["Capital improvements to date", usd(((p.building || {}).improvements || 0) + sum((p.entries || []).filter((e) => e.category === "Capital improvements"), (e) => e.amount)), "entered + ledger"],
        ]));
    }).catch((e) => body.replaceChildren(h("p", { class: "note" }, e.message)));
    return sec;
  }
  const mtable = (rows) => table([{ label: "Measure", get: (r) => r[0] }, { label: "Value", num: 1, get: (r) => r[1] }, { label: "", get: (r) => h("span", { class: "muted small" }, r[2]) }], rows);

  /* ---------- tax, insurance, basis and reserves ---------- */
  function taxSection(p, run, pid) {
    const pr = p.profile || {}, b = p.building || {};
    const sec = section("Property tax, insurance, tax basis and reserves");
    const f = {
      taxPin: input("text", pr.taxPin, { placeholder: "e.g. 08-12-345-678" }), assessedValue: input("number", pr.assessedValue, { step: "1" }), taxRate: input("number", pr.taxRate, { step: "0.001", placeholder: "%" }),
      appealDeadline: input("date", pr.appealDeadline),
      insuranceCarrier: input("text", pr.insuranceCarrier), insurancePremium: input("number", pr.insurancePremium, { step: "1" }), insuranceCoverage: input("number", pr.insuranceCoverage, { step: "1" }), insuranceRenewal: input("date", pr.insuranceRenewal),
      costSeg: input("text", pr.costSeg, { placeholder: "e.g. study done 2026, 22% to 5/7/15-year" }), exchange1031: h("textarea", { rows: 2 }, pr.exchange1031 || ""),
      capexReserve: input("number", pr.capexReserve, { step: "1" }), covenants: h("textarea", { rows: 2 }, pr.covenants || ""), rateResetDate: input("date", pr.rateResetDate),
    };
    const T = (cat, y) => sum((p.entries || []).filter((e) => e.category === cat && e.date.slice(0, 4) === String(y)), (e) => e.amount);
    const years = [...new Set((p.entries || []).map((e) => e.date.slice(0, 4)).concat((pr.reserves || []).map((r) => String(r.year))))].sort().reverse().slice(0, 6);
    const taxPaid12 = sum((p.entries || []).filter((e) => e.category === "Property tax" && e.date > addMonths(today(), -12)), (e) => e.amount);
    const resRows = h("div");
    const addRes = (r = {}) => resRows.append(h("div", { class: "ws-row" }, field("Year", input("number", r.year ?? "", { step: "1" })), field("Capex $", input("number", r.capex ?? "", { step: "1" })), field("Tenant improvements $", input("number", r.ti ?? "", { step: "1" })), field("Leasing commissions $", input("number", r.lc ?? "", { step: "1" }))));
    (pr.reserves && pr.reserves.length ? pr.reserves : []).forEach(addRes);
    const save = h("button", { type: "button", class: "btn-small" }, "Save");
    save.addEventListener("click", () => {
      const reserves = [...resRows.children].map((r) => { const [y, c, t, l] = r.querySelectorAll("input"); return { year: y.value, capex: c.value, ti: t.value, lc: l.value }; }).filter((r) => r.year);
      run({ op: "setProfile", profile: { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), reserves } }, "Saved.");
    });
    const life = b.propertyType === "commercial" || b.propertyType === "mixed" ? 39 : 27.5;
    const basis = b.purchasePrice ? b.purchasePrice * (1 - (b.landPct ?? 20) / 100) + (b.improvements || 0) : null;
    const d = h("details", { class: "ws-add" }, h("summary", {}, [pr.taxPin ? `PIN ${pr.taxPin}` : "Tax PIN not entered", taxPaid12 ? `${usd(taxPaid12)} property tax paid, last 12 months` : null, pr.insuranceCarrier ? `insured with ${pr.insuranceCarrier}` : null].filter(Boolean).join(" · ")));
    d.append(
      h("h4", { class: "inc-head" }, "Property tax"),
      h("p", { class: "note" }, `Annual property tax: ${usd(taxPaid12)} paid in the last 12 months (from the ledger, including payments found in the bank feed).${pr.assessedValue && pr.taxRate ? ` Assessed ${usd(pr.assessedValue)} × ${pr.taxRate}% = ${usd(pr.assessedValue * pr.taxRate / 100)} estimated.` : ""} Cook County reassesses every three years; DuPage and the collar counties every four, with appeal windows each year.`),
      h("div", { class: "ws-row" }, field("Tax PIN", f.taxPin), field("Assessed value $", f.assessedValue), field("Tax rate %", f.taxRate), field("Appeal deadline", f.appealDeadline, "Shows on the Overview 12 months ahead")),
      h("h4", { class: "inc-head" }, "Insurance"),
      h("div", { class: "ws-row" }, field("Carrier", f.insuranceCarrier), field("Annual premium $", f.insurancePremium), field("Coverage $", f.insuranceCoverage), field("Renews", f.insuranceRenewal)),
      h("h4", { class: "inc-head" }, "Debt terms"),
      h("div", { class: "ws-row" }, field("Covenants", f.covenants, "e.g. DSCR ≥ 1.25×, tested annually"), field("Rate reset date", f.rateResetDate)),
      h("h4", { class: "inc-head" }, "Tax basis"),
      h("p", { class: "note" }, basis ? `Depreciable basis ${usd(basis)} (price less ${b.landPct ?? 20}% land, plus improvements) over ${life} years: ${usd(basis / life)} a year. Edit the purchase price, land share and placed-in-service date in Building details; cost segregation detail is on the Inputs tab.` : "Add the purchase price and land share in Building details to see depreciation."),
      h("div", { class: "ws-row" }, field("Cost segregation", f.costSeg), field("1031 exchange history", f.exchange1031)),
      h("h4", { class: "inc-head" }, "Reserves and leasing costs"),
      h("div", { class: "ws-row" }, field("Capex reserve balance $", f.capexReserve)),
      years.length ? table([{ label: "Year", get: (y) => y }, { label: "Capital improvements (ledger)", num: 1, get: (y) => usd(T("Capital improvements", y)) }, { label: "Tenant improvements (ledger)", num: 1, get: (y) => usd(T("Tenant improvements", y)) }, { label: "Leasing commissions (ledger)", num: 1, get: (y) => usd(T("Leasing commissions", y)) }], years) : null,
      h("p", { class: "note" }, "Amounts paid outside the tagged accounts can be entered by year:"), resRows,
      h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "link-button dark", onclick: () => addRes({ year: new Date().getFullYear() }) }, "+ Add a year"), save));
    sec.append(d);
    return sec;
  }

  /* ======================= lease uploader (Properties tab and AI Assistant) ======================= */
  function leaseUploader({ propertyId = null, compact = false } = {}) {
    const box = h("div", { class: "px-up" });
    const fileIn = h("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, class: "ws-file" });
    const list = h("div");
    const msg = h("p", { class: "note" });
    let pending = [], configured = true, busy = false;
    const putFile = (url, file) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("PUT", url); x.setRequestHeader("Content-Type", file.type || "application/pdf"); x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error(`Upload failed (${x.status})`))); x.onerror = () => rej(new Error("Upload failed. Check the connection.")); x.send(file); });
    async function upload(files) {
      files = [...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (!files.length) { msg.textContent = "Pick PDF files."; return; }
      const ids = [];
      for (const [i, f] of files.entries()) {
        msg.textContent = `Uploading ${i + 1} of ${files.length}: ${f.name}…`;
        try {
          const sig = await api("/api/docs", { op: "sign", filename: f.name, size: f.size });
          await putFile(sig.url, f);
          await api("/api/docs", { op: "commit", id: sig.id, pathname: sig.pathname, filename: f.name, label: f.name.replace(/\.[^.]+$/, ""), category: "Property & leases", notes: "Uploaded as a lease" });
          ids.push(sig.id);
        } catch (e) { msg.textContent = `${f.name}: ${e.message}`; }
      }
      if (!ids.length) return;
      pending = (await api("/api/leases", { op: "queue", docIds: ids, propertyId })).pending;
      fileIn.value = "";
      paint();
      readAll();
    }
    async function readAll() {
      if (busy) return;
      busy = true;
      try {
        for (;;) {
          const next = mine().find((x) => x.status === "queued");
          if (!next) break;
          next.status = "reading"; paint();
          msg.textContent = `Reading ${next.filename}… (about a minute each)`;
          try { pending = (await api("/api/leases", { op: "extract", id: next.id })).pending; } catch (e) { next.status = "error"; next.error = e.message; }
          paint();
        }
        msg.textContent = mine().some((x) => x.status === "ready") ? "Check each lease below and approve it." : "";
      } finally { busy = false; }
    }
    const mine = () => pending.filter((x) => !propertyId || x.propertyId === propertyId || (!x.propertyId && x.suggestedProperty === propertyId));
    function paint() {
      const items = mine();
      list.replaceChildren(...items.map(card));
      if (!configured) msg.textContent = "Reading leases needs the AI key (ANTHROPIC_API_KEY) on this site's Vercel project. Uploads are still saved to Documents.";
    }
    function card(it) {
      const PD = window.BSProps && window.BSProps.data;
      const head = h("h4", {}, it.filename, h("span", { class: "px-pill" + (it.status === "ready" ? " ok" : it.status === "error" || it.status === "not-a-lease" ? " bad" : "") },
        ({ queued: "waiting", reading: "reading…", ready: it.result && it.result.kind === "amendment" ? "amendment read" : "read", error: "couldn't read", "not-a-lease": "not a lease" })[it.status] || it.status));
      const c = h("div", { class: "px-card" + (it.status === "error" ? " err" : "") }, head);
      if (it.status === "error") c.append(h("p", { class: "note" }, it.error || ""), h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small ghost", onclick: async () => { it.status = "queued"; paint(); readAll(); } }, "Try again"), discardBtn(it)));
      if (it.status === "not-a-lease") c.append(h("p", { class: "note" }, "This doesn't look like a lease or amendment. It stays in Documents."), h("div", { class: "ws-row-btns" }, discardBtn(it)));
      if (it.status === "ready" && it.result) {
        const L = it.result.lease;
        const ids = PD ? (PD.order || Object.keys(PD.properties)).filter((id) => PD.properties[id].status === "active") : [];
        const propSel = select([["", "Pick the property"]].concat(ids.map((id) => [id, PD.properties[id].name])), it.propertyId || it.suggestedProperty || "");
        const pid = () => propSel.value;
        const targetSel = h("span");
        const fillTargets = () => {
          const p = PD && PD.properties[pid()];
          const ls = (p && p.leases) || [];
          if (it.result.kind !== "amendment" && !ls.some((l) => (l.tenant || "").toLowerCase() === (L.tenant || "").toLowerCase())) { targetSel.replaceChildren(); return; }
          const s = select([["", "Add as a new lease"]].concat(ls.map((l) => [l.id, `Apply to ${l.tenant} (to ${fmtDate(l.expiration)})`])), it.amendsLeaseId || "");
          s.className = "ws-select"; s.dataset.target = "1";
          targetSel.replaceChildren(field(it.result.kind === "amendment" ? "This amends" : "Same tenant on file", s));
        };
        propSel.addEventListener("change", fillTargets); fillTargets();
        const ed = leaseEditor(L, (window.BSBalance && window.BSBalance.data && window.BSBalance.data.uses) || []);
        const approve = h("button", { type: "button", class: "btn-small" }, it.result.kind === "amendment" ? "Approve amendment" : "Approve lease");
        approve.addEventListener("click", async () => {
          if (!pid()) { alert("Pick the property this lease belongs to."); return; }
          approve.disabled = true;
          try {
            const t = targetSel.querySelector("[data-target]");
            const out = await api("/api/leases", { op: "approve", id: it.id, propertyId: pid(), lease: ed.value(), leaseId: t && t.value ? t.value : null });
            pending = out.pending;
            msg.textContent = `Saved to ${PD.properties[out.propertyId].name}.`;
            paint();
            changed(["properties"]);
            if (window.BSProps && window.BSProps.reload) await window.BSProps.reload();
          } catch (e) { approve.disabled = false; alert(e.message); }
        });
        c.append(
          it.result.kind === "amendment" ? h("p", { class: "note" }, h("strong", {}, "Amendment. "), it.result.changes || (it.result.amends && it.result.amends.summary) || "") : null,
          !propertyId || !it.propertyId ? h("div", { class: "ws-row" }, field("Property", propSel, it.result.address ? `Address in the lease: ${it.result.address}` : null), targetSel) : h("div", { class: "ws-row" }, targetSel),
          leaseFacts(L), h("p", { class: "note" }, "Correct anything below before approving; the rest saves as read."), ed.el,
          h("div", { class: "ws-row-btns" }, approve, h("a", { class: "dark-link", href: `/api/docs?dl=${encodeURIComponent(it.docId)}`, target: "_blank", rel: "noopener" }, "Open the PDF"), discardBtn(it)));
      }
      return c;
    }
    const discardBtn = (it) => h("button", { type: "button", class: "link-button danger", onclick: async () => { if (!confirm(`Discard ${it.filename} from the queue? The PDF stays in Documents.`)) return; pending = (await api("/api/leases", { op: "discard", id: it.id })).pending; paint(); } }, "Discard");
    fileIn.addEventListener("change", () => upload(fileIn.files));
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drag"); });
    box.addEventListener("dragleave", () => box.classList.remove("drag"));
    box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drag"); upload(e.dataTransfer.files); });
    box.append(h("label", { class: "tax-field" }, h("span", {}, compact ? "Upload lease PDFs" : "Lease PDFs (drop several at once)"), fileIn), msg, list);
    api("/api/leases").then((r) => { pending = r.pending; configured = r.configured; paint(); if (mine().some((x) => x.status === "queued" || x.status === "reading")) { mine().forEach((x) => { if (x.status === "reading") x.status = "queued"; }); readAll(); } }).catch(() => {});
    return box;
  }

  window.BSPropX = { sections, alerts, leaseUploader, criticalDates, missedRent, leaseRentOn };
})();
