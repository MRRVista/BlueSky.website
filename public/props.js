// Blue Sky properties: building details, rent and expense ledger (manual entry and Excel upload),
// mortgage terms and schedule. Everything saves to the server and is shared by every signed-in user.
// Also exposes the math the Performance tab uses to layer the property onto the portfolio.
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const who = (e) => String(e || "").replace(/@.*/, "").replace(/^mrice$/, "Matt").replace(/^jen$/, "Jen");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const pad = (n) => String(n).padStart(2, "0");

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
  const sheet = (title, lede) => h("article", { class: "sheet dash ws" }, h("h2", {}, title), lede ? h("p", { class: "lede" }, lede) : null);
  const section = (title, note) => h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const input = (type, value, attrs = {}) => h("input", { type, value: value ?? "", ...attrs });
  const select = (options, value) => h("select", { class: "ws-select" }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; const opt = h("option", { value: v }, l); if (String(v) === String(value ?? "")) opt.selected = true; return opt; }));
  const kpis = (items) => h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
    h("div", { class: "kpi-label" }, k.label), h("div", { class: "kpi-value" + (k.neg ? " neg" : "") }, k.value), k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  const toast = (root, msg, kind = "ok") => {
    const t = h("div", { class: `ws-toast ${kind}`, role: "status" }, msg);
    (root.querySelector("article") || root).prepend(t);
    setTimeout(() => t.remove(), kind === "err" ? 7000 : 2500);
  };
  function table(cols, rows, cls = "grid dgrid") {
    const t = h("table", { class: cls });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    const tb = h("tbody");
    rows.forEach((r) => tb.append(h("tr", { class: r._class || null }, cols.map((c) => {
      const v = c.get(r), raw = c.raw ? c.raw(r) : null;
      return h("td", { class: [c.num ? "num" : "", raw != null && raw < 0 ? "neg" : ""].filter(Boolean).join(" ") || null }, v);
    }))));
    t.append(tb);
    return h("div", { class: "sheet-scroll" }, t);
  }

  // Styles for the property views and the ticker inputs (kept here so the shared stylesheet is untouched).
  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.periodbar .pb.soon { border-style: dashed; color: #5a6b86; }
.periodbar .pb.soon.on { color: var(--gold); }
.soon-tag { display: inline-block; margin-left: 0.45rem; font-size: 0.68rem; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase; padding: 0.08rem 0.45rem; border-radius: 999px; background: #fff5cc; color: #7a5a00; vertical-align: middle; }
.periodbar .pb:disabled .soon-tag { background: #eef1f6; color: #8a99b2; }
.soon-box { background: #fff; border: 1px dashed #c9d4e3; border-radius: 8px; padding: 1.1rem 1.25rem; margin-top: 0.5rem; color: #263753; }
.soon-box h3 { margin: 0 0 0.4rem; }
.soon-list { margin: 0.5rem 0 0.25rem; padding-left: 1.1rem; }
.soon-list li { margin: 0.3rem 0; }
.ws-file { font: inherit; font-size: 0.875rem; }
.layerbar { margin-bottom: 0.4rem; }
.bm-ticker { font: inherit; font-size: 0.9rem; color: #0c1c36; border: 1px solid #c9d4e3; border-radius: 4px; padding: 0.45rem 0.6rem; width: 7.5rem; text-transform: uppercase; }
.bm-ticker:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(201, 162, 98, 0.28); }
` }));

  /* ======================= data ======================= */
  let data = null, loading = null;
  const listeners = new Set();
  function load(force) {
    if (data && !force) return Promise.resolve(data);
    if (loading && !force) return loading;
    loading = fetch("/api/properties", { credentials: "same-origin" }).then(async (r) => {
      if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
      if (!r.ok) throw new Error("Couldn't load the property data.");
      data = await r.json();
      loading = null;
      return data;
    }).catch((e) => { loading = null; throw e; });
    return loading;
  }
  async function save(body) {
    const r = await fetch("/api/properties", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, version: data && data.version }) });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const out = await r.json().catch(() => ({}));
    if (r.status === 409 && out.data) { data = out.data; [...listeners].forEach((f) => f()); throw new Error(out.error); }
    if (!r.ok) throw new Error(out.error || "Something went wrong. Try again.");
    data = out;
    [...listeners].forEach((f) => f());
    return data;
  }

  /* ======================= math (shared with Performance) ======================= */
  const catType = (name, d = data) => ((d && d.categories.find((c) => c.name === name)) || {}).type || "expense";
  function addMonths(d, n) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
    const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m + n, Math.min(day, last))).toISOString().slice(0, 10);
  }
  const payment = (principal, annualPct, months) => {
    const r = annualPct / 100 / 12;
    return r === 0 ? principal / months : (r * principal) / (1 - Math.pow(1 + r, -months));
  };
  // Monthly amortization schedule. A shorter term than the amortization means a balloon at the last payment.
  function schedule(m) {
    if (!m || !(m.amount > 0) || !(m.amortYears > 0) || !m.firstPaymentDate) return null;
    const n = Math.round(m.amortYears * 12), term = m.termYears ? Math.round(m.termYears * 12) : n, r = (m.rate || 0) / 100 / 12;
    const pmt = m.paymentOverride > 0 ? m.paymentOverride : payment(m.amount, m.rate || 0, n);
    const rows = [];
    let bal = m.amount;
    for (let k = 1; k <= term && bal > 0.005; k++) {
      const interest = bal * r;
      let principal = Math.min(pmt - interest, bal);
      let balloon = 0;
      if (k === term && term < n) { balloon = bal - principal; }
      bal = bal - principal - balloon;
      rows.push({ n: k, date: addMonths(m.firstPaymentDate, k - 1), payment: interest + principal, interest, principal, balloon, balance: Math.max(bal, 0) });
    }
    return { payment: pmt, months: n, term, rows, balloon: rows.length && rows[rows.length - 1].balloon };
  }
  function balanceOn(m, d) {
    const s = schedule(m);
    if (!s) return null;
    if (d < m.loanDate) return 0;
    let bal = m.amount;
    for (const r of s.rows) { if (r.date <= d) bal = r.balance; else break; }
    return bal;
  }
  // Everything dated after `lo` and on or before `hi`.
  function between(propId, lo, hi, d = data) {
    const p = d && d.properties[propId];
    const out = { rent: 0, costs: 0, byCat: {}, interest: 0, principal: 0, balloon: 0, payment: 0, entries: 0 };
    if (!p || p.status !== "active") return out;
    for (const e of p.entries) {
      if (!(e.date > lo && e.date <= hi)) continue;
      out.entries++;
      out.byCat[e.category] = (out.byCat[e.category] || 0) + e.amount;
      if (catType(e.category, d) === "income") out.rent += e.amount; else out.costs += e.amount;
    }
    const s = p.mortgage && schedule(p.mortgage);
    if (s) for (const r of s.rows) {
      if (!(r.date > lo && r.date <= hi)) continue;
      out.interest += r.interest; out.principal += r.principal; out.balloon += r.balloon; out.payment += r.payment;
    }
    out.netOperating = out.rent - out.costs;
    out.netCash = out.rent - out.costs - out.payment - out.balloon;
    out.economic = out.rent - out.costs - out.interest;
    return out;
  }

  /* ======================= Excel parsing ======================= */
  let xlsxLib = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLib) return xlsxLib;
    xlsxLib = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      sc.onload = () => resolve(window.XLSX);
      sc.onerror = () => { xlsxLib = null; reject(new Error("The spreadsheet reader didn't load. Check the connection and try again.")); };
      document.head.append(sc);
    });
    return xlsxLib;
  }
  function parseDate(v, XLSX) {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (typeof v === "number" && XLSX && v > 20000 && v < 80000) { const c = XLSX.SSF.parse_date_code(v); return c ? `${c.y}-${pad(c.m)}-${pad(c.d)}` : null; }
    const s = String(v).trim();
    let m;
    const ok = (y, mo, d = 1) => { y = +y; if (y < 100) y += 2000; mo = +mo; d = +d; if (!(y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null; return `${y}-${pad(mo)}-${pad(d)}`; };
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/))) return ok(m[1], m[2], m[3] || 1);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return ok(m[3], m[1], m[2]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return ok(m[2], m[1]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?[\s,\-']*(\d{1,2})?,?[\s\-']*(\d{2,4})$/))) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
      if (mi >= 0) return m[2] && m[3].length >= 2 && +m[2] <= 31 && m[3].length === 4 ? ok(m[3], mi + 1, m[2]) : ok(m[3], mi + 1);
    }
    return null;
  }
  function parseAmount(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).trim();
    if (!s) return null;
    const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /−/.test(s);
    s = s.replace(/[()$,\s−-]/g, "");
    if (!/^\d*\.?\d+$/.test(s)) return null;
    return (negative ? -1 : 1) * Number(s);
  }
  async function readSheet(file) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return { XLSX, rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }), sheetName: wb.SheetNames[0] };
  }
  // Column A date or month, column B amount, optional column C category and column D description.
  function interpret(rows, XLSX, cats, chosenCat, existing) {
    const catByLower = new Map(cats.map((c) => [c.name.toLowerCase(), c.name]));
    const out = [];
    rows.forEach((r, i) => {
      const [a, b, c, d] = r;
      if (r.every((x) => x == null || String(x).trim() === "")) return;
      const date = parseDate(a, XLSX), amount = parseAmount(b);
      if (i === 0 && !date) return; // header row
      const row = { line: i + 1, rawA: a instanceof Date ? a.toLocaleDateString() : a, rawB: b, date, amount, description: d != null ? String(d).trim() : null };
      if (chosenCat === "__col") {
        const cname = c != null ? catByLower.get(String(c).trim().toLowerCase()) : null;
        row.category = cname || null;
        if (!cname) row.problem = c ? `Category "${c}" isn't on the list` : "Column C (category) is empty";
      } else {
        row.category = chosenCat;
        if (c != null && String(c).trim() && !row.description) row.description = String(c).trim();
      }
      if (!date) row.problem = `Can't read "${row.rawA ?? ""}" as a date or month`;
      else if (amount == null || amount === 0) row.problem = `Can't read "${b ?? ""}" as an amount`;
      if (!row.problem) {
        row.dup = existing.some((e) => e.category === row.category && e.date.slice(0, 7) === date.slice(0, 7) && Math.abs(e.amount - amount) < 0.005)
          || out.some((o) => !o.problem && o.category === row.category && o.date.slice(0, 7) === date.slice(0, 7) && Math.abs(o.amount - amount) < 0.005);
      }
      out.push(row);
    });
    return out;
  }

  /* ======================= UI ======================= */
  let curProp = (() => { try { return sessionStorage.getItem("bs-prop") || "5100-main"; } catch { return "5100-main"; } })();
  let filter = { cat: "", year: "" };

  function propChips(onPick, { compact } = {}) {
    const ids = data.order || Object.keys(data.properties);
    return h("div", { class: "periodbar", role: "group", "aria-label": "Property" },
      compact ? h("span", { class: "pb-label" }, "Property") : null,
      ids.map((id) => {
        const p = data.properties[id], soon = p.status !== "active", on = id === curProp;
        const b = h("button", { type: "button", class: "pb" + (on ? " on" : "") + (soon ? " soon" : ""), "aria-pressed": on ? "true" : "false" },
          p.name, soon ? h("span", { class: "soon-tag" }, "Coming soon") : null);
        b.addEventListener("click", () => { curProp = id; try { sessionStorage.setItem("bs-prop", id); } catch {} onPick(id); });
        return b;
      }));
  }

  function render(slug, root) {
    root.replaceChildren(sheet("Properties", "Loading…"));
    load().then(() => draw(root)).catch((e) => { if (e.message !== "signed out") root.replaceChildren(sheet("Properties", e.message)); });
  }

  function draw(root) {
    const redraw = () => draw(root);
    listeners.clear();
    listeners.add(redraw);
    if (!data.properties[curProp]) curProp = (data.order || Object.keys(data.properties))[0];
    const p = data.properties[curProp];
    const s = sheet("Properties", "Building details, rent, expenses and the mortgage for each property. Everything saves to the site for both of you and stays until it's changed. These figures feed the property layers on the Performance tab.");
    s.append(propChips(redraw));
    root.replaceChildren(s);
    if (p.status !== "active") return comingSoon(s, p);

    const run = async (body, ok) => {
      try { await save({ ...body, property: curProp }); if (ok) toast(root, ok); }
      catch (e) { if (e.message !== "signed out") toast(root, e.message, "err"); }
    };

    // ---- summary
    const t = today(), yearAgo = addMonths(t, -12);
    const L12 = between(curProp, yearAgo, t);
    const sched = p.mortgage && schedule(p.mortgage);
    const bal = p.mortgage ? balanceOn(p.mortgage, t) : null;
    s.append(kpis([
      { label: "Net cash flow, last 12 months", value: usd(L12.netCash), neg: L12.netCash < 0, sub: "rent − costs − mortgage payments", lead: true },
      { label: "Rent, last 12 months", value: usd(L12.rent), sub: `${p.entries.filter((e) => catType(e.category) === "income").length} rent entries on file` },
      { label: "Costs, last 12 months", value: usd(L12.costs), sub: "taxes, insurance, repairs, other" },
      { label: "Mortgage payment", value: sched ? usd(sched.payment, 2) : "—", sub: sched ? `principal + interest, ${p.mortgage.rate}%` : "add the loan below" },
      { label: "Loan balance today", value: bal == null ? "—" : usd(bal), sub: p.mortgage ? `of ${usd(p.mortgage.amount)} borrowed ${fmtDate(p.mortgage.loanDate)}` : "" },
    ]));

    s.append(buildingSection(p, run));
    s.append(mortgageSection(p, run));
    s.append(ledgerSection(root, p, run));

    const logD = h("details", { class: "ws-add" }, h("summary", {}, `Change log (${(p.log || []).length})`));
    logD.append((p.log || []).length ? table([
      { label: "When", get: (r) => fmtWhen(r.at) }, { label: "Who", get: (r) => who(r.by) }, { label: "Change", get: (r) => r.change },
    ], p.log) : h("p", { class: "note" }, "No changes yet."));
    s.append(section("History"), logD);
  }

  function comingSoon(s, p) {
    s.append(h("div", { class: "soon-box" },
      h("h3", {}, `${p.name}`, h("span", { class: "soon-tag" }, "Coming soon")),
      h("p", {}, `${p.name} will have the same inputs as 5100 Main. They'll open here once the property's details are ready to enter:`),
      h("ul", { class: "soon-list" },
        h("li", {}, h("strong", {}, "Building"), " — address, purchase date and price, current value, size and units"),
        h("li", {}, h("strong", {}, "Rent"), " — monthly rent by Excel upload or entered by hand"),
        h("li", {}, h("strong", {}, "Expenses"), " — property taxes, insurance, repairs, utilities, management and other costs, by upload or by hand"),
        h("li", {}, h("strong", {}, "Mortgage"), " — loan amount, date, rate and amortization, with the payment schedule calculated"),
        h("li", {}, h("strong", {}, "Performance"), " — its own property layer alongside the portfolio")),
      h("p", { class: "note" }, "Nothing can be entered for this property yet.")));
  }

  function buildingSection(p, run) {
    const b = p.building || {};
    const f = {
      address: input("text", b.address, { placeholder: "Street, city, state" }),
      purchaseDate: input("date", b.purchaseDate), purchasePrice: input("number", b.purchasePrice, { step: "0.01", min: "0" }),
      currentValue: input("number", b.currentValue, { step: "0.01", min: "0" }), valueAsOf: input("date", b.valueAsOf),
      squareFeet: input("number", b.squareFeet, { step: "1", min: "0" }), units: input("number", b.units, { step: "1", min: "0" }),
      notes: h("textarea", { rows: 2 }, b.notes || ""),
    };
    const wrap = h("details", { class: "ws-add" }, h("summary", {}, b.address ? `${b.address}${b.currentValue ? ` · value ${usd(b.currentValue)}` : ""}` : "Add building details"));
    const saveBtn = h("button", { type: "button", class: "btn-small" }, "Save building details");
    saveBtn.addEventListener("click", () => run({ op: "setBuilding", building: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) }, "Building details saved."));
    wrap.append(h("div", { class: "ws-row" }, field("Address", f.address), field("Purchase date", f.purchaseDate), field("Purchase price $", f.purchasePrice)),
      h("div", { class: "ws-row" }, field("Current value $", f.currentValue, "Optional. Not used in returns yet."), field("Value as of", f.valueAsOf), field("Square feet", f.squareFeet), field("Units", f.units)),
      field("Notes", f.notes), h("div", { class: "ws-row-btns" }, saveBtn, b.updatedAt ? h("span", { class: "note inline" }, `Last saved by ${who(b.updatedBy)}, ${fmtWhen(b.updatedAt)}`) : null));
    const sec = section("Building");
    sec.append(wrap);
    return sec;
  }

  function mortgageSection(p, run) {
    const m = p.mortgage || {};
    const sec = section("Mortgage", "Fixed-rate loan. The payment and schedule are calculated from these terms; enter a payment override only if the lender's payment differs. Property taxes and insurance go in the ledger below, not here.");
    const f = {
      lender: input("text", m.lender, { placeholder: "Lender" }),
      amount: input("number", m.amount, { step: "0.01", min: "0" }), loanDate: input("date", m.loanDate),
      firstPaymentDate: input("date", m.firstPaymentDate), rate: input("number", m.rate, { step: "0.001", min: "0" }),
      amortYears: input("number", m.amortYears, { step: "1", min: "1", placeholder: "30" }), termYears: input("number", m.termYears, { step: "1", min: "1", placeholder: "same as amortization" }),
      paymentOverride: input("number", m.paymentOverride, { step: "0.01", min: "0", placeholder: "calculated" }),
      notes: h("textarea", { rows: 2 }, m.notes || ""),
    };
    const preview = h("p", { class: "note" });
    const val = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    const numify = (o) => ({ ...o, amount: +o.amount, rate: +o.rate, amortYears: +o.amortYears, termYears: o.termYears ? +o.termYears : null, paymentOverride: o.paymentOverride ? +o.paymentOverride : null,
      firstPaymentDate: o.firstPaymentDate || (o.loanDate ? new Date(Date.UTC(+o.loanDate.slice(0, 4), +o.loanDate.slice(5, 7) + 1, 1)).toISOString().slice(0, 10) : null) });
    const upd = () => {
      const s = schedule(numify(val()));
      preview.textContent = s ? `Monthly principal and interest: ${usd(s.payment, 2)} for ${s.rows.length} payments${s.balloon > 0 ? `, then a ${usd(s.balloon)} balloon on ${fmtDate(s.rows[s.rows.length - 1].date)}` : ""}. Total interest over the term: ${usd(sum(s.rows, (r) => r.interest))}.` : "Enter the amount, rate, loan date and amortization to see the payment.";
    };
    Object.values(f).forEach((el) => el.addEventListener("input", upd));
    upd();
    const saveBtn = h("button", { type: "button", class: "btn-small" }, p.mortgage ? "Save mortgage terms" : "Add mortgage");
    saveBtn.addEventListener("click", () => run({ op: "setMortgage", mortgage: val() }, "Mortgage saved."));
    const clearBtn = p.mortgage ? h("button", { type: "button", class: "link-button danger" }, "Remove mortgage") : null;
    if (clearBtn) clearBtn.addEventListener("click", () => { if (confirm("Remove the mortgage from this property?")) run({ op: "clearMortgage" }, "Mortgage removed."); });
    const form = h("details", { class: "ws-add", open: !p.mortgage }, h("summary", {}, p.mortgage ? `${m.lender || "Loan"}: ${usd(m.amount)} at ${m.rate}%, ${m.amortYears}-year amortization${m.termYears && m.termYears < m.amortYears ? `, ${m.termYears}-year term` : ""} · edit` : "Enter the loan terms"));
    form.append(h("div", { class: "ws-row" }, field("Lender", f.lender), field("Loan amount $", f.amount), field("Loan date", f.loanDate), field("First payment", f.firstPaymentDate, "Defaults to the 1st of the second month after the loan date")),
      h("div", { class: "ws-row" }, field("Interest rate %", f.rate), field("Amortization (years)", f.amortYears), field("Term / balloon (years)", f.termYears, "Leave blank if it fully amortizes"), field("Payment override $", f.paymentOverride)),
      field("Notes", f.notes), preview, h("div", { class: "ws-row-btns" }, saveBtn, clearBtn, m.updatedAt ? h("span", { class: "note inline" }, `Last saved by ${who(m.updatedBy)}, ${fmtWhen(m.updatedAt)}`) : null));
    sec.append(form);

    const s = p.mortgage && schedule(p.mortgage);
    if (s) {
      const t = today(), made = s.rows.filter((r) => r.date <= t), next12 = s.rows.filter((r) => r.date > t).slice(0, 12);
      sec.append(h("div", { class: "ws-facts" },
        fact("Payment (P&I)", usd(s.payment, 2)), fact("Payments made", `${made.length} of ${s.rows.length}`),
        fact("Balance today", usd(balanceOn(p.mortgage, t))), fact("Interest, next 12 payments", usd(sum(next12, (r) => r.interest))),
        fact("Principal, next 12 payments", usd(sum(next12, (r) => r.principal))), s.balloon > 0 ? fact("Balloon", `${usd(s.balloon)} on ${fmtDate(s.rows[s.rows.length - 1].date)}`) : null));
      const det = h("details", { class: "lots" }, h("summary", {}, `Full payment schedule (${s.rows.length} payments)`));
      det.append(table([
        { label: "#", num: 1, get: (r) => r.n }, { label: "Date", num: 1, get: (r) => fmtDate(r.date) },
        { label: "Payment", num: 1, get: (r) => usd(r.payment + r.balloon, 2) }, { label: "Interest", num: 1, get: (r) => usd(r.interest, 2) },
        { label: "Principal", num: 1, get: (r) => usd(r.principal + r.balloon, 2) }, { label: "Balance", num: 1, get: (r) => usd(r.balance, 2) },
      ], s.rows.map((r) => ({ ...r, _class: r.date <= t && (s.rows[r.n] || {}).date > t ? "sum" : null }))));
      sec.append(det);
    }
    return sec;
  }
  const fact = (label, value) => h("div", {}, h("div", { class: "ws-label" }, label), h("div", { class: "ws-fact" }, value));

  function ledgerSection(root, p, run) {
    const cats = data.categories;
    const catOpts = cats.map((c) => [c.name, `${c.name}${c.type === "income" ? " (income)" : ""}`]);
    const sec = section("Rent and expenses", "One ledger for the property. Rent counts as money in and every other category as money out, so enter amounts as positive numbers. A negative amount is a reversal, such as a tax refund.");

    // ---- add by hand
    const a = { date: input("date", today()), category: select(catOpts, "Rent"), amount: input("number", "", { step: "0.01" }), description: input("text", "", { placeholder: "Optional" }),
      repeat: select([["0", "Just once"], ["1", "Every month"], ["3", "Every quarter"], ["6", "Twice a year"], ["12", "Once a year"]], "0"), times: input("number", "12", { min: "1", max: "600", step: "1" }) };
    const timesField = field("How many times", a.times);
    timesField.hidden = true;
    a.repeat.addEventListener("change", () => { timesField.hidden = a.repeat.value === "0"; });
    const addBtn = h("button", { type: "button", class: "btn-small" }, "Add");
    addBtn.addEventListener("click", () => {
      if (!a.date.value || !a.amount.value) return toast(root, "Enter a date and an amount.", "err");
      const step = +a.repeat.value, n = step ? Math.max(1, Math.min(600, +a.times.value || 1)) : 1;
      const entries = Array.from({ length: n }, (_, i) => ({ date: addMonths(a.date.value, i * step), category: a.category.value, amount: +a.amount.value, description: a.description.value }));
      run({ op: "addEntries", entries, source: "manual" }, n > 1 ? `Added ${n} entries.` : "Added.");
    });
    const addBox = h("details", { class: "ws-add" }, h("summary", {}, "Add an entry by hand"),
      h("div", { class: "ws-row" }, field("Date", a.date, "For a monthly item, any day in the month"), field("Category", a.category), field("Amount $", a.amount), field("Description", a.description)),
      h("div", { class: "ws-row" }, field("Repeat", a.repeat), timesField), h("div", { class: "ws-row-btns" }, addBtn));

    // ---- upload
    const fileIn = h("input", { type: "file", accept: ".xlsx,.xls,.csv,text/csv", class: "ws-file" });
    const upCat = select([["__col", "Category is in column C"], ...catOpts], "Rent");
    const upOut = h("div");
    const upBox = h("details", { class: "ws-add" }, h("summary", {}, "Upload from Excel"),
      h("p", { class: "note" }, "First sheet only. Column A is the month or date, column B the amount. Optional column C names the category (or pick one category for the whole file) and column D a description. A header row is fine."),
      h("div", { class: "ws-row" }, field("Spreadsheet", fileIn), field("Category", upCat)), upOut);
    let lastRead = null;
    const preview = () => {
      if (!lastRead) return;
      const rows = interpret(lastRead.rows, lastRead.XLSX, cats, upCat.value, p.entries);
      const good = rows.filter((r) => !r.problem), bad = rows.filter((r) => r.problem), dups = good.filter((r) => r.dup);
      const usedCats = [...new Set(good.map((r) => r.category))];
      const mode = select([["add", "Add to the existing entries"], ["replace", `Replace all existing ${usedCats.join(", ") || "matching"} entries`]], "add");
      const skipDup = h("input", { type: "checkbox", checked: true });
      const go = h("button", { type: "button", class: "btn-small", disabled: !good.length }, `Save ${good.length} entr${good.length === 1 ? "y" : "ies"}`);
      const count = () => { const n = mode.value === "add" && skipDup.checked ? good.length - dups.length : good.length; go.textContent = `Save ${n} entr${n === 1 ? "y" : "ies"}`; go.disabled = !n; };
      mode.addEventListener("change", () => { dupRow.hidden = mode.value !== "add" || !dups.length; count(); });
      skipDup.addEventListener("change", count);
      const dupRow = h("label", { class: "ws-check", hidden: !dups.length }, skipDup, `Skip ${dups.length} row${dups.length === 1 ? "" : "s"} that match an entry already on file (same month, category and amount)`);
      go.addEventListener("click", async () => {
        const use = mode.value === "add" && skipDup.checked ? good.filter((r) => !r.dup) : good;
        if (mode.value === "replace" && !confirm(`Replace every existing ${usedCats.join(", ")} entry for ${p.name} with these ${use.length}? The old entries go to Recently deleted.`)) return;
        go.disabled = true;
        await run({ op: "addEntries", mode: mode.value, replaceCategories: usedCats, source: lastRead.name, entries: use.map((r) => ({ date: r.date, category: r.category, amount: r.amount, description: r.description })) }, `Saved ${use.length} entries from ${lastRead.name}.`);
      });
      upOut.replaceChildren(
        h("p", { class: "note" }, `Read ${rows.length} row${rows.length === 1 ? "" : "s"} from "${lastRead.sheetName}" in ${lastRead.name}: ${good.length} ready${dups.length ? `, ${dups.length} possible duplicate${dups.length === 1 ? "" : "s"}` : ""}${bad.length ? `, ${bad.length} can't be read and will be skipped` : ""}. Total ${usd(sum(good, (r) => r.amount), 2)}.`),
        table([
          { label: "Row", num: 1, get: (r) => r.line },
          { label: "Date", get: (r) => (r.date ? fmtDate(r.date) : String(r.rawA ?? "")) },
          { label: "Category", get: (r) => r.category || "—" },
          { label: "Amount", num: 1, get: (r) => (r.amount != null ? usd(r.amount, 2) : String(r.rawB ?? "")), raw: (r) => r.amount },
          { label: "Description", get: (r) => r.description || "" },
          { label: "Status", get: (r) => (r.problem ? h("span", { class: "warn-text" }, r.problem) : r.dup ? h("span", { class: "muted" }, "Possible duplicate") : r.amount < 0 ? "Reversal" : "Ready") },
        ], rows),
        h("div", { class: "ws-row" }, field("How to save", mode)), dupRow, h("div", { class: "ws-row-btns" }, go));
      count();
    };
    fileIn.addEventListener("change", async () => {
      const file = fileIn.files[0];
      if (!file) return;
      upOut.replaceChildren(h("p", { class: "note" }, "Reading…"));
      try { lastRead = { ...(await readSheet(file)), name: file.name }; preview(); }
      catch (e) { upOut.replaceChildren(h("p", { class: "note warn-text" }, e.message || "Couldn't read that file.")); }
    });
    upCat.addEventListener("change", preview);

    // ---- new category
    const newCat = input("text", "", { placeholder: "e.g. HOA dues" }), newType = select([["expense", "Money out"], ["income", "Money in"]], "expense");
    const catBtn = h("button", { type: "button", class: "btn-small" }, "Add category");
    catBtn.addEventListener("click", async () => {
      try { await save({ op: "addCategory", name: newCat.value, type: newType.value }); toast(root, "Category added."); }
      catch (e) { toast(root, e.message, "err"); }
    });
    const catBox = h("details", { class: "ws-add" }, h("summary", {}, "Categories"),
      h("p", { class: "note" }, cats.map((c) => `${c.name} (${c.type === "income" ? "in" : "out"})`).join(" · ")),
      h("div", { class: "ws-row" }, field("New category", newCat), field("Type", newType)), h("div", { class: "ws-row-btns" }, catBtn));

    sec.append(addBox, upBox, catBox);

    // ---- table
    const years = [...new Set(p.entries.map((e) => e.date.slice(0, 4)))].sort().reverse();
    const fCat = select([["", "All categories"], ...cats.map((c) => c.name)], filter.cat), fYear = select([["", "All years"], ...years], filter.year);
    const exportBtn = h("button", { type: "button", class: "btn-small" }, "Export to Excel");
    exportBtn.addEventListener("click", () => exportXlsx(p).catch((e) => toast(root, e.message, "err")));
    const holder = h("div");
    const paint = () => {
      filter = { cat: fCat.value, year: fYear.value };
      const rows = p.entries.filter((e) => (!filter.cat || e.category === filter.cat) && (!filter.year || e.date.startsWith(filter.year))).slice().reverse();
      if (!rows.length) { holder.replaceChildren(h("p", { class: "note" }, p.entries.length ? "No entries match the filter." : "No entries yet. Add one by hand or upload a spreadsheet above.")); return; }
      const signed = (e) => (catType(e.category) === "income" ? e.amount : -e.amount);
      const tb = table([
        { label: "Date", get: (r) => fmtDate(r.date) },
        { label: "Category", get: (r) => r.category },
        { label: "Description", get: (r) => r.description || "" },
        { label: "Amount", num: 1, get: (r) => usd(signed(r), 2), raw: (r) => signed(r) },
        { label: "Source", get: (r) => h("span", { class: "muted small" }, r.source === "manual" ? "entered" : r.source) },
        { label: "Last change", get: (r) => h("span", { class: "muted small" }, `${who(r.updatedBy)}, ${fmtDate(String(r.updatedAt).slice(0, 10))}`) },
        { label: "", get: (r) => h("span", { class: "ws-actions" },
          h("button", { type: "button", class: "link-button dark", onclick: () => editRow(r) }, "Edit"),
          h("button", { type: "button", class: "link-button danger", onclick: () => run({ op: "deleteEntries", ids: [r.id] }, "Deleted. Restore it from Recently deleted.") }, "Delete")) },
      ], rows);
      const totIn = sum(rows.filter((e) => catType(e.category) === "income"), (e) => e.amount), totOut = sum(rows.filter((e) => catType(e.category) !== "income"), (e) => e.amount);
      holder.replaceChildren(tb, h("p", { class: "note" }, `${rows.length} entr${rows.length === 1 ? "y" : "ies"}: ${usd(totIn, 2)} in, ${usd(totOut, 2)} out, net ${usd(totIn - totOut, 2)}.`));
    };
    const editRow = (r) => {
      const e = { date: input("date", r.date), category: select(catOpts, r.category), amount: input("number", r.amount, { step: "0.01" }), description: input("text", r.description || "") };
      const ok = h("button", { type: "button", class: "btn-small" }, "Save");
      const cancel = h("button", { type: "button", class: "link-button dark" }, "Cancel");
      ok.addEventListener("click", () => run({ op: "updateEntry", id: r.id, entry: { date: e.date.value, category: e.category.value, amount: +e.amount.value, description: e.description.value } }, "Saved."));
      cancel.addEventListener("click", paint);
      holder.replaceChildren(h("div", { class: "ws-add" }, h("h3", {}, `Edit ${r.category}, ${fmtDate(r.date)}`),
        h("div", { class: "ws-row" }, field("Date", e.date), field("Category", e.category), field("Amount $", e.amount), field("Description", e.description)),
        h("div", { class: "ws-row-btns" }, ok, cancel)));
    };
    fCat.addEventListener("change", paint); fYear.addEventListener("change", paint);
    sec.append(h("div", { class: "ws-toolbar" }, fCat, fYear, exportBtn), holder);
    paint();

    // ---- trash
    if ((p.trash || []).length) {
      const det = h("details", { class: "ws-add" }, h("summary", {}, `Recently deleted (${p.trash.length})`));
      const all = h("button", { type: "button", class: "btn-small" }, "Restore all");
      all.addEventListener("click", () => run({ op: "restoreEntries", ids: p.trash.map((x) => x.id) }, "Restored."));
      det.append(h("div", { class: "ws-row-btns" }, all), table([
        { label: "Date", get: (r) => fmtDate(r.date) }, { label: "Category", get: (r) => r.category },
        { label: "Amount", num: 1, get: (r) => usd(r.amount, 2) }, { label: "Deleted", get: (r) => `${who(r.deletedBy)}, ${fmtWhen(r.deletedAt)}${r.deletedReason ? ` (${r.deletedReason})` : ""}` },
        { label: "", get: (r) => h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "restoreEntries", ids: [r.id] }, "Restored.") }, "Restore") },
      ], p.trash.slice(0, 300)));
      sec.append(det);
    }
    return sec;
  }

  async function exportXlsx(p) {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const ledger = [["Date", "Category", "Type", "Amount", "Description", "Source", "Last changed by", "Last changed"]]
      .concat(p.entries.map((e) => [e.date, e.category, catType(e.category) === "income" ? "In" : "Out", e.amount, e.description || "", e.source, who(e.updatedBy), e.updatedAt]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledger), "Ledger");
    const s = p.mortgage && schedule(p.mortgage);
    if (s) {
      const m = p.mortgage;
      const terms = [["Lender", m.lender || ""], ["Amount", m.amount], ["Loan date", m.loanDate], ["First payment", m.firstPaymentDate], ["Rate %", m.rate], ["Amortization (years)", m.amortYears], ["Term (years)", m.termYears || m.amortYears], ["Monthly P&I", Math.round(s.payment * 100) / 100]];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(terms), "Mortgage");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["#", "Date", "Payment", "Interest", "Principal", "Balance"]].concat(s.rows.map((r) => [r.n, r.date, +(r.payment + r.balloon).toFixed(2), +r.interest.toFixed(2), +(r.principal + r.balloon).toFixed(2), +r.balance.toFixed(2)]))), "Schedule");
    }
    const b = p.building || {};
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Address", b.address || ""], ["Purchase date", b.purchaseDate || ""], ["Purchase price", b.purchasePrice ?? ""], ["Current value", b.currentValue ?? ""], ["Value as of", b.valueAsOf || ""], ["Square feet", b.squareFeet ?? ""], ["Units", b.units ?? ""], ["Notes", b.notes || ""]]), "Building");
    XLSX.writeFile(wb, `${p.name.replace(/\W+/g, "_")}_${today()}.xlsx`);
  }

  window.BSProps = {
    tabs: [{ slug: "properties", name: "Properties" }],
    render,
    load, get data() { return data; }, catType, schedule, between, balanceOn, propChips,
    get current() { return curProp; }, set current(v) { curProp = v; try { sessionStorage.setItem("bs-prop", v); } catch {} },
  };
})();
