// Blue Sky wealth view: Overview (net worth, balance sheet, property valuations) and Cash Flow
// (a monthly forecaster with debt service and estimated taxes). Pulls together the Schwab portfolio,
// both properties and every loan on the Admin tab; assumptions are shared through /api/plan.
(function () {
  /* ---------- helpers ---------- */
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usdK = (n) => n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1e6 ? `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M` : usd(n);
  const pct = (n, d = 1) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const mult = (n) => n == null || !isFinite(n) ? "—" : n.toFixed(2) + "×";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ymLabel = (ym) => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const addMonths = (d, n) => {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +(d.slice(8, 10) || 1);
    const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m + n, Math.min(day, last))).toISOString().slice(0, 10);
  };
  const ymAdd = (ym, n) => addMonths(ym + "-01", n).slice(0, 7);

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
  const kpis = (items) => h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
    h("div", { class: "kpi-label" }, k.label),
    h("div", { class: "kpi-value" + (String(k.value).startsWith("−") ? " neg" : "") }, k.value),
    k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  function table(cols, rows, opts = {}) {
    const t = h("table", { class: "grid dgrid" + (opts.cls ? " " + opts.cls : "") });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    const tb = h("tbody");
    rows.forEach((r) => tb.append(h("tr", { class: r._class || null }, cols.map((c) => {
      const v = c.get(r), raw = c.raw ? c.raw(r) : null;
      return h("td", { class: [c.num ? "num" : "", raw != null && raw < -0.004 ? "neg" : ""].filter(Boolean).join(" ") || null }, v);
    }))));
    t.append(tb);
    return h("div", { class: "sheet-scroll", tabindex: "0" }, t);
  }
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const C = { gold: "#c9a262", navy: "#183763", sky: "#2f5e96", haze: "#8fb3d9", red: "#b42318", green: "#2e7d4f", grey: "#9aa7bb", bronze: "#a76b2d", plum: "#7d6aa8", slate: "#5b6b85" };
  const moneyTick = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`);
  function chartBox(height = 300) { const canvas = h("canvas"); return { box: h("div", { class: "chart", style: `height:${height}px` }, canvas), canvas }; }
  function draw(canvas, config) {
    if (!window.Chart) { canvas.parentElement.replaceChildren(h("p", { class: "note" }, "Chart library didn't load. Refresh to try again.")); return null; }
    Chart.defaults.font.family = '"Jost", system-ui, sans-serif';
    Chart.defaults.color = "#4a5b78";
    return new Chart(canvas, config);
  }
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Something went wrong. Try again."); e.data = d.data; e.status = r.status; throw e; }
    return d;
  };

  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.ov-warn { margin: 0.25rem 0 0.5rem; padding: 0.7rem 1rem 0.7rem 2rem; background: #fff8e6; border: 1px solid #f0dca8; border-radius: 8px; color: #5c4400; font-size: 0.875rem; }
.ov-warn li { margin: 0.2rem 0; }
.dash a.dark-link { color: #183763; font-weight: 500; }
` }));

  /* ---------- assumptions ---------- */
  const DEFAULTS = {
    horizon: 5,              // years
    incomeGrowth: 0,         // % a year, portfolio distributions
    priceGrowth: 0,          // % a year, portfolio market value
    marginMode: "hold",      // hold | paydown (surplus cash repays margin)
    fedShift: 0,             // percentage points added to floating rates
    rentGrowth: 3, expenseGrowth: 3, valueGrowth: 2, // % a year, real estate
    refiBalloons: true,      // assume balloon payments are refinanced at the same terms
    rentalTax: "passive",    // passive (losses carried) | offset (losses reduce other income)
    priorPassiveLoss: 0,     // suspended passive losses carried into the forecast ($)
    taxTiming: "monthly",    // monthly set-aside | quarterly estimates
    startCash: 0,            // cash on hand at the start ($)
  };
  let saved = null;     // last plan loaded from the server
  let draft = null;     // unsaved edits in this browser
  const A = () => ({ ...DEFAULTS, ...(saved && saved.assumptions), ...(draft && draft.assumptions) });
  const items = () => (draft && draft.items) || (saved && saved.items) || [];
  function setDraft(patch) {
    draft = { assumptions: { ...(draft && draft.assumptions), ...(patch.assumptions || {}) }, items: patch.items || (draft && draft.items) || null };
    if (!draft.items) delete draft.items;
  }

  /* ---------- data ---------- */
  let cache = null;
  async function loadAll(force) {
    if (cache && !force) return cache;
    const [loans, plan] = await Promise.all([api("/api/loans").catch(() => null), api("/api/plan").catch(() => ({ version: 0, assumptions: {}, items: [] })), window.BSProps ? window.BSProps.load(force).catch(() => null) : null,
      window.BSBalance ? window.BSBalance.load(force).catch(() => null) : null]);
    saved = plan;
    cache = { loans, props: window.BSProps && window.BSProps.data, analytics: window.BSAnalytics || null, balance: window.BSBalance && window.BSBalance.data };
    return cache;
  }
  window.addEventListener("bs:data-changed", () => { cache = null; });

  /* ---------- taxes (shares the Income tab's assumptions) ---------- */
  function taxRates() {
    if (window.BSDash && window.BSDash.taxRates) return window.BSDash.taxRates();
    return { ordinary: 0.37 + 0.0495 + 0.038, qualified: 0.20 + 0.0495 + 0.038, roc: 0, interestSave: 0.37 + 0.038 };
  }
  // Effective rate on portfolio distributions from the last 12 months' mix of tax characters.
  function portfolioTaxRate(an) {
    const R = taxRates();
    if (!an || !window.BSDash || !window.BSDash.itemTax) return { rate: R.ordinary, basis: "ordinary rate (no income history)" };
    const end = an.performance && an.performance.end || today();
    const from = addMonths(end, -12);
    const it = an.income.items.filter((x) => x.k !== "Margin interest" && x.d > from && x.d <= end);
    const gross = sum(it, (x) => x.a);
    if (!gross) return { rate: R.ordinary, basis: "ordinary rate (no income history)" };
    return { rate: sum(it, (x) => window.BSDash.itemTax(x, R)) / gross, basis: "last 12 months' mix of income types, Income tab rates" };
  }

  /* ---------- properties ---------- */
  function propertyView(id, D) {
    const B = window.BSProps, p = D.properties[id], b = p.building || {};
    const t = today(), from = addMonths(t, -12);
    const T12 = B.between(id, from, t);
    const rentMonths = new Set(p.entries.filter((e) => e.date > from && e.date <= t && B.catType(e.category) === "income").map((e) => e.date.slice(0, 7))).size;
    const hasPF = b.grossRent > 0;
    const src = b.noiSource === "actual" ? "actual" : b.noiSource === "proforma" ? (hasPF ? "proforma" : "actual") : (rentMonths >= 10 || !hasPF ? "actual" : "proforma");
    const gross = src === "proforma" ? b.grossRent * (1 - (b.vacancyPct || 0) / 100) : T12.rent;
    const potential = src === "proforma" ? b.grossRent : T12.rent;
    const opex = src === "proforma" ? (b.opexAnnual || 0) : T12.costs;
    const noi = gross - opex;
    const cap = b.capRate > 0 ? b.capRate / 100 : null;
    let value = null, valueBasis = "";
    if ((b.valuationMethod || "cap") === "cap" && cap && noi > 0) { value = noi / cap; valueBasis = `NOI ÷ ${b.capRate}% cap rate`; }
    else if (b.currentValue > 0) { value = b.currentValue; valueBasis = `entered${b.valueAsOf ? ` ${fmtDate(b.valueAsOf)}` : ""}`; }
    else if (b.purchasePrice > 0) { value = b.purchasePrice; valueBasis = "purchase price (no value or cap rate entered)"; }
    // depreciation
    const life = b.propertyType === "commercial" || b.propertyType === "mixed" ? 39 : 27.5;
    const basis = b.purchasePrice > 0 ? b.purchasePrice * (1 - (b.landPct ?? 20) / 100) + (b.improvements || 0) : 0;
    const pis = b.placedInService || b.purchaseDate || null;
    const depAnnual = basis ? basis / life : 0;
    const depEnd = pis ? addMonths(pis, Math.round(life * 12)) : null;
    return { id, name: p.name, p, b, src, rentMonths, potential, gross, opex, noi, cap, value, valueBasis, life, depBasis: basis, depAnnual, depStart: pis, depEnd,
      landAssumed: b.landPct == null && basis > 0, t12: T12 };
  }

  /* ---------- debts ---------- */
  // One record per open debt with what's needed to project it month by month.
  function inferSecures(l, D) {
    if (l.secures) return l.secures;
    if (l.kind === "margin") return "portfolio";
    const n = `${l.name || ""} ${l.notes || ""}`.toLowerCase();
    if (D) for (const id of D.order || Object.keys(D.properties)) { const nm = D.properties[id].name.toLowerCase(); if (n.includes(nm) || n.includes(nm.split(" ")[0])) return id; }
    return "other";
  }
  function debtList(L, D, an, asm) {
    const out = [];
    const fedUpper = L && L.fed && L.fed.upper;
    if (L) L.loans.filter((l) => (l.status || "open") === "open").forEach((l) => {
      const c = L.rows.find((r) => r.id === l.id) || {};
      if (c.balance == null) return;
      const floating = l.rateType === "floating";
      const rate = (c.rate ?? 0) + (floating ? asm.fedShift : 0);
      const secures = inferSecures(l, D);
      const d = { id: l.id, name: l.name, lender: l.lender, kind: l.kind, floating, rate, baseRate: c.rate, secures, guessed: !l.secures, balance: c.balance, source: "Admin tab", maturity: l.maturityDate || null, escrow: c.escrow || 0 };
      if (l.kind === "amortizing") {
        Object.assign(d, { payment: c.payment, next: c.nextPayment, left: l.maturityDate ? c.paymentsToMaturity : Math.max(0, Number(l.amortMonths || 0) - (c.paymentsMade || 0)), balloon: c.balloon || 0 });
      }
      if (l.kind === "margin") d.dayBasis = 360;
      out.push(d);
    });
    // Property mortgages entered on the Properties tab, unless an Admin loan already covers that property.
    if (D) (D.order || Object.keys(D.properties)).forEach((id) => {
      const p = D.properties[id];
      if (p.status !== "active" || !p.mortgage) return;
      if (out.some((d) => d.secures === id && d.kind !== "margin")) return;
      const B = window.BSProps, s = B.schedule(p.mortgage); if (!s) return;
      const t = today(), rest = s.rows.filter((r) => r.date > t);
      const bal = B.balanceOn(p.mortgage, t);
      if (!(bal > 0)) return;
      out.push({ id: `pm-${id}`, name: `${p.name} mortgage`, lender: p.mortgage.lender, kind: "amortizing", floating: false, rate: p.mortgage.rate, baseRate: p.mortgage.rate, secures: id, guessed: false, balance: bal, source: "Properties tab",
        payment: s.payment, next: rest.length ? rest[0].date : null, left: rest.length, balloon: rest.length ? rest[rest.length - 1].balloon : 0, maturity: rest.length ? rest[rest.length - 1].date : null, escrow: 0 });
    });
    // Margin implied by the positions export when no margin loan is set up on the Admin tab.
    const pos = an && an.positions;
    if (pos && pos.margin > 0 && !out.some((d) => d.kind === "margin")) {
      const rate = (fedUpper != null ? fedUpper + 0.75 : 6) + asm.fedShift;
      out.push({ id: "margin-implied", name: "Schwab margin loan", lender: "Schwab", kind: "margin", floating: true, rate, baseRate: rate - asm.fedShift, secures: "portfolio", guessed: false, balance: pos.margin, source: `positions ${fmtDate(pos.asOf)}; rate assumed Fed upper + 0.75%`, dayBasis: 360, escrow: 0 });
    }
    return out;
  }

  /* ---------- the model ---------- */
  function buildModel(ctx, asm) {
    const an = ctx.analytics, D = ctx.props, L = ctx.loans;
    const t0 = today(), startYM = ymAdd(t0.slice(0, 7), 1);
    const N = Math.round(Math.min(Math.max(asm.horizon, 1), 10) * 12);
    const months = Array.from({ length: N }, (_, k) => ymAdd(startYM, k));
    const R = taxRates();
    const PT = portfolioTaxRate(an);

    // portfolio
    const pos = an && an.positions;
    const mv0 = pos ? sum(pos.holdings, (x) => x.marketValue) : 0;
    let inc0 = pos ? sum(pos.holdings, (x) => x.marketValue * (x.yield || 0)) : 0;
    let incBasis = pos ? `current yields on the ${fmtDate(pos.asOf)} positions` : "";
    if (!inc0 && an) {
      const end = an.performance.end || t0, from = addMonths(end, -12);
      inc0 = sum(an.income.items.filter((x) => x.k !== "Margin interest" && x.d > from && x.d <= end), (x) => x.a);
      incBasis = "income received over the last 12 months";
    }

    // properties
    const props = D ? (D.order || Object.keys(D.properties)).filter((id) => D.properties[id].status === "active").map((id) => propertyView(id, D)) : [];
    const soon = D ? (D.order || Object.keys(D.properties)).filter((id) => D.properties[id].status !== "active").map((id) => D.properties[id].name) : [];

    // debts (the balance sheet drops removed loans, applies Plaid balances and adds liabilities entered on the Overview)
    const debts = window.BSBalance && ctx.balance ? window.BSBalance.adjustDebts(debtList(L, D, an, asm)) : debtList(L, D, an, asm);

    // custom cash flows
    const custom = items().filter((i) => i.on !== false);
    const customAt = (i, ym) => {
      const s = i.start.slice(0, 7), e = i.end ? i.end.slice(0, 7) : null;
      if (ym < s || (e && ym > e)) return 0;
      const k = (+ym.slice(0, 4) - +s.slice(0, 4)) * 12 + (+ym.slice(5, 7) - +s.slice(5, 7));
      const hit = i.freq === "once" ? k === 0 : i.freq === "monthly" ? true : i.freq === "quarterly" ? k % 3 === 0 : k % 12 === 0;
      return hit ? i.amount * Math.pow(1 + (i.growth || 0) / 100, Math.floor(k / 12)) : 0;
    };

    // one pass of the monthly projection; `taxByMonth` comes from the previous pass
    function run(taxByMonth) {
      const st = debts.map((d) => ({ d, bal: d.balance, paid: 0 }));
      let cash = asm.startCash || 0;
      const rows = [];
      months.forEach((ym, k) => {
        const yr = Math.floor(k / 12);
        const r = { ym, k, year: ym.slice(0, 4), ent: {} };
        const E = (id) => (r.ent[id] = r.ent[id] || { inc: 0, opex: 0, interest: 0, principal: 0, balloon: 0, other: 0, tax: 0, dep: 0 });
        // portfolio income and value
        r.portIncome = (inc0 / 12) * Math.pow(1 + asm.incomeGrowth / 100, k / 12);
        r.portValue = mv0 * Math.pow(1 + asm.priceGrowth / 100, (k + 1) / 12);
        E("portfolio").inc += r.portIncome;
        // properties
        r.rent = 0; r.opex = 0;
        props.forEach((pv) => {
          const rent = (pv.gross / 12) * Math.pow(1 + asm.rentGrowth / 100, yr);
          const opex = (pv.opex / 12) * Math.pow(1 + asm.expenseGrowth / 100, yr);
          const e = E(pv.id); e.inc += rent; e.opex += opex;
          const ymFirst = ym + "-15";
          e.dep += pv.depAnnual && pv.depStart && ymFirst >= pv.depStart && (!pv.depEnd || ymFirst <= pv.depEnd) ? pv.depAnnual / 12 : 0;
          r.rent += rent; r.opex += opex;
        });
        // debts
        r.interest = 0; r.principal = 0; r.balloon = 0; r.marginInterest = 0;
        st.forEach((s) => {
          const d = s.d, e = E(d.secures === "portfolio" || props.some((p) => p.id === d.secures) ? d.secures : "other");
          if (s.bal <= 0.005) return;
          if (d.kind === "amortizing") {
            const nextYM = d.next ? d.next.slice(0, 7) : null;
            const due = nextYM && ym >= nextYM && (asm.refiBalloons || s.paid < d.left);
            if (!due) return;
            const int = (s.bal * d.rate) / 1200;
            const prin = Math.min(Math.max(d.payment - int, 0), s.bal);
            s.bal -= prin; s.paid++;
            e.interest += int; e.principal += prin; r.interest += int; r.principal += prin;
            if (!asm.refiBalloons && s.paid === d.left && d.maturity && s.bal > 0.5) { e.balloon += s.bal; r.balloon += s.bal; s.bal = 0; }
          } else {
            const int = (s.bal * d.rate) / 100 / 12 * (d.dayBasis === 360 ? 365 / 360 : 1);
            e.interest += int; r.interest += int;
            if (d.kind === "margin") r.marginInterest += int;
          }
        });
        // custom
        r.custom = 0; r.customTaxable = 0;
        custom.forEach((i) => {
          const a = customAt(i, ym); if (!a) return;
          const e = E(i.entity && (i.entity === "portfolio" || props.some((p) => p.id === i.entity)) ? i.entity : "other");
          e.other += a; r.custom += a;
          if (i.tax === "ordinary" || i.tax === "deductible") r.customTaxable += a;
        });
        r.tax = taxByMonth ? taxByMonth[k] || 0 : 0;
        r.preTax = r.portIncome + r.rent - r.opex - r.interest - r.principal - r.balloon + r.custom;
        r.net = r.preTax - r.tax;
        // surplus cash repays margin when chosen
        r.paydown = 0;
        if (asm.marginMode === "paydown" && r.net > 0) {
          const m = st.find((s) => s.d.kind === "margin" && s.bal > 0);
          if (m) { r.paydown = Math.min(m.bal, r.net); m.bal -= r.paydown; }
        }
        cash += r.net - r.paydown;
        r.cash = cash;
        r.debtBal = sum(st, (s) => Math.max(s.bal, 0));
        r.debtBy = Object.fromEntries(st.map((s) => [s.d.id, Math.max(s.bal, 0)]));
        r.propValue = sum(props, (pv) => (pv.value || 0) * Math.pow(1 + asm.valueGrowth / 100, (k + 1) / 12));
        r.netWorth = r.portValue + r.propValue + cash - r.debtBal;
        rows.push(r);
      });
      return rows;
    }

    // taxes by calendar year, then spread into months
    function taxes(rows) {
      const years = [...new Set(rows.map((r) => r.year))];
      let carry = -Math.abs(asm.priorPassiveLoss || 0);
      const byYear = {};
      years.forEach((y) => {
        const rs = rows.filter((r) => r.year === y);
        const port = sum(rs, (r) => r.portIncome), mInt = sum(rs, (r) => r.marginInterest);
        const portTax = port * PT.rate;
        const intSave = Math.min(mInt, port) * R.interestSave;
        const perProp = props.map((pv) => {
          const e = rs.map((r) => r.ent[pv.id] || {});
          const net = sum(e, (x) => (x.inc || 0) - (x.opex || 0) - (x.interest || 0) - (x.dep || 0));
          return { id: pv.id, net, dep: sum(e, (x) => x.dep || 0) };
        });
        const rentalNet = sum(perProp, (x) => x.net);
        let rentalTaxable = rentalNet;
        const carryStart = carry;
        if (asm.rentalTax === "passive") {
          const total = rentalNet + carry;
          if (total < 0) { carry = total; rentalTaxable = 0; } else { carry = 0; rentalTaxable = total; }
        }
        const rentalTax = rentalTaxable * R.ordinary; // NIIT applies to passive rental income
        const custTax = sum(rs, (r) => r.customTaxable) * (R.ordinary - 0.038);
        const total = portTax - intSave + rentalTax + custTax;
        // attribute to entities
        const posNets = perProp.filter((x) => x.net > 0), posSum = sum(posNets, (x) => x.net);
        const ent = { portfolio: portTax - intSave, other: custTax };
        perProp.forEach((x) => { ent[x.id] = asm.rentalTax === "passive" ? (x.net > 0 && posSum ? rentalTax * x.net / posSum : 0) : x.net * R.ordinary; });
        byYear[y] = { year: y, months: rs.length, port, portTax, mInt, intSave, perProp, rentalNet, rentalTaxable, rentalTax, custTax, total, carryStart, carryEnd: carry, ent };
      });
      const byMonth = rows.map(() => 0);
      if (asm.taxTiming === "quarterly") {
        years.forEach((y) => {
          const due = [`${y}-04`, `${y}-06`, `${y}-09`, `${+y + 1}-01`].filter((m) => m >= months[0] && m <= months[months.length - 1]);
          const T = byYear[y].total;
          if (!due.length) return;
          due.forEach((m) => { byMonth[months.indexOf(m)] += T / due.length; });
        });
      } else rows.forEach((r, k) => { byMonth[k] = byYear[r.year].total / byYear[r.year].months; });
      return { byYear, byMonth };
    }

    let rows = run(null);
    let tx = taxes(rows);
    rows = run(tx.byMonth);
    tx = taxes(rows); // margin paydown changes interest slightly; settle once more
    rows = run(tx.byMonth);
    // per-entity tax in each month (for the statements), proportional to the year's attribution
    rows.forEach((r, k) => {
      const Y = tx.byYear[r.year];
      Object.entries(Y.ent).forEach(([id, v]) => { if (r.ent[id] || v) { r.ent[id] = r.ent[id] || { inc: 0, opex: 0, interest: 0, principal: 0, balloon: 0, other: 0, tax: 0, dep: 0 }; r.ent[id].tax = Y.total ? (tx.byMonth[k] * v) / Y.total : 0; } });
    });

    // today's balance sheet
    const debtToday = debts.map((d) => ({ ...d }));
    const assets = [];
    if (pos) assets.push({ id: "portfolio", name: "Schwab account …965", value: mv0, basis: `${pos.holdings.length} holdings, ${fmtDate(pos.asOf)} positions` });
    if (pos && pos.cash > 0) assets.push({ id: "portfolio-cash", name: "Schwab cash", value: pos.cash, basis: fmtDate(pos.asOf), group: "portfolio" });
    props.forEach((pv) => assets.push({ id: pv.id, name: pv.name, value: pv.value || 0, basis: pv.value ? pv.valueBasis : "no value yet: add a cap rate or value on the Properties tab", missing: !pv.value }));
    if (asm.startCash) assets.push({ id: "cash", name: "Other cash", value: asm.startCash, basis: "Cash Flow assumptions" });
    // Accounts outside …965 (IRA and others) from the Inputs page.
    const extra = window.BSInputs && window.BSInputs.accountsForOverview ? window.BSInputs.accountsForOverview() : [];
    extra.forEach((a) => assets.push({ id: `acct-${a.id}`, name: a.name, value: a.value, basis: `${a.type === "ira" ? "IRA, " : ""}${a.source === "plaid" ? "Plaid" : "entered"} ${fmtDate(a.asOf)}`, group: "accounts" }));
    const totalAssets = sum(assets, (a) => a.value), totalDebt = sum(debtToday, (d) => d.balance);

    const M = { asm, months, rows, tax: tx, props, soon, debts: debtToday, assets, totalAssets, totalDebt, netWorth: totalAssets - totalDebt,
      mv0, inc0, incBasis, pos, PT, R, custom, startYM };
    // Today's totals follow the balance sheet (rows removed there, Plaid accounts and manual entries added there).
    if (window.BSBalance && ctx.balance) {
      try { const T = window.BSBalance.compute(M); M.totalAssets = T.totalAssets; M.totalDebt = T.totalLiab; M.netWorth = T.netWorth; M.otherAssets = T.totalAssets - (mv0 + (pos && pos.cash > 0 ? pos.cash : 0)) - sum(props, (p) => p.value || 0) - (asm.startCash || 0);
        // Accounts outside the forecast (IRAs, bank accounts, anything added by hand) are carried at today's value.
        rows.forEach((r) => { r.otherAssets = M.otherAssets; r.netWorth += M.otherAssets; }); }
      catch (e) { console.error("balance sheet totals", e); }
    }
    return M;
  }

  // Sum a window of model rows into a statement by entity.
  function statement(M, from, to) {
    const rs = M.rows.slice(from, to);
    const ids = ["portfolio", ...M.props.map((p) => p.id), "other"];
    const col = (id) => {
      const e = rs.map((r) => r.ent[id] || {});
      const s = (k) => sum(e, (x) => x[k] || 0);
      const o = { inc: s("inc"), opex: s("opex"), interest: s("interest"), principal: s("principal"), balloon: s("balloon"), other: s("other"), tax: s("tax"), dep: s("dep") };
      o.noi = o.inc - o.opex; o.pre = o.inc - o.opex - o.interest - o.principal - o.balloon + o.other; o.net = o.pre - o.tax;
      return o;
    };
    const cols = Object.fromEntries(ids.map((id) => [id, col(id)]));
    const tot = {}; ["inc", "opex", "interest", "principal", "balloon", "other", "tax", "dep", "noi", "pre", "net"].forEach((k) => { tot[k] = sum(ids, (id) => cols[id][k]); });
    return { ids, cols, tot, months: rs.length };
  }

  // Today's model and the next 12 months, for the Properties tab's metrics (same numbers as the Overview).
  async function snapshot(force) { const ctx = await loadAll(force); const M = buildModel(ctx, A()); return { M, Y1: statement(M, 0, 12), ctx }; }
  window.BSWealthModel = { buildModel, statement, DEFAULTS, snapshot }; // also for testing

  /* ======================= OVERVIEW ======================= */
  const entName = (M, id) => (id === "portfolio" ? "Portfolio" : id === "other" ? "Other" : (M.props.find((p) => p.id === id) || {}).name || id);
  const securedName = (M, id) => (id === "portfolio" ? "Schwab portfolio" : id === "other" ? "Other / unsecured" : (M.props.find((p) => p.id === id) || {}).name || id);

  async function renderOverview(root) {
    root.replaceChildren(sheet("Overview", "Loading…"));
    let ctx;
    try { ctx = await loadAll(true); } catch (e) { if (e.message !== "signed out") root.replaceChildren(sheet("Overview", e.message)); return; }
    const M = buildModel(ctx, A());
    const s = sheet("Overview", "Everything Jen owns and owes in one place: the Schwab account, the properties, every loan and any account added from Plaid, with the next 12 months of cash flow after estimated taxes.");
    const Y1 = statement(M, 0, 12);
    const toast = (msg, kind = "ok") => { const t = h("div", { class: `ws-toast ${kind}`, role: "status" }, msg); s.prepend(t); setTimeout(() => t.remove(), kind === "err" ? 7000 : 2500); };
    const BS = window.BSBalance && ctx.balance ? window.BSBalance.render(M, () => renderOverview(root), toast) : null;
    const T = BS ? BS.totals : { totalAssets: M.totalAssets, totalLiab: M.totalDebt, netWorth: M.netWorth };
    const realEstate = BS ? sum(T.assets.filter((a) => a.key.startsWith("sys:prop:") || ["home", "reresi", "reoffice", "remedical", "reretail", "remixed", "strental", "realestate2"].includes(a.type)), (a) => a.value) : sum(M.props, (p) => p.value || 0);

    s.append(kpis([
      { label: "Net worth", value: usdK(T.netWorth), sub: `${usdK(T.totalAssets)} assets − ${usdK(T.totalLiab)} liabilities`, lead: true },
      { label: "Total assets", value: usdK(T.totalAssets), sub: `real estate ${usdK(realEstate)}, everything else ${usdK(T.totalAssets - realEstate)}` },
      { label: "Total liabilities", value: usdK(T.totalLiab), sub: M.totalDebt ? `${pct(sum(M.debts, (d) => d.balance * d.rate / 100) / M.totalDebt, 2)} weighted rate` : "" },
      { label: "Debt to assets", value: pct(T.totalAssets ? T.totalLiab / T.totalAssets : null), sub: "leverage across everything" },
      { label: "Cash flow, next 12 months", value: usd(Y1.tot.net), sub: `after ${usd(Y1.tot.tax)} estimated taxes; ${usd(Y1.tot.net / 12)} a month`, lead: true },
    ]));
    if (window.BSAttention) s.append(window.BSAttention.box(M, ctx, BS && BS.totals));
    const warn = [];
    if (M.soon.length) warn.push(`${M.soon.join(" and ")} ${M.soon.length > 1 ? "aren't" : "isn't"} switched on yet, so ${M.soon.length > 1 ? "they're" : "it's"} not included. Switch it on from the Properties tab.`);
    if (!M.pos) warn.push("No Schwab positions are on file, so the portfolio isn't included. Upload a positions export on the Upload page, or tag the Schwab account to Plaid.");
    if (warn.length) s.append(h("ul", { class: "ov-warn" }, warn.map((w) => h("li", {}, w))));

    // Balance sheet
    s.append(section("Balance sheet", "Today's values. Assets on top, liabilities below. Drag rows (or use the arrows) to reorder; link each liability to the asset it's against. Real estate is valued from net operating income and the cap rate on the Properties tab, or the value entered there."));
    if (BS) s.append(BS.el);
    const rows = BS ? T.assets.map((a) => ({ name: a.name, equity: a.equity, debt: a.debt })) : [];
    if (rows.length) {
      const { box, canvas } = chartBox(Math.max(160, rows.length * 48 + 60));
      s.append(box);
      draw(canvas, { type: "bar", data: { labels: rows.map((r) => r.name), datasets: [
        { label: "Equity", data: rows.map((r) => Math.max(r.equity, 0)), backgroundColor: C.gold, stack: "a" },
        { label: "Debt", data: rows.map((r) => r.debt), backgroundColor: C.slate, stack: "a" },
      ] }, options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true, ticks: { callback: moneyTick } }, y: { stacked: true } } } });
    }

    // Next 12 months by entity
    s.append(section(`Cash flow, ${ymLabel(M.months[0])} – ${ymLabel(M.months[Math.min(11, M.months.length - 1)])}`, "Projected from today's holdings, the property ledgers or pro forma, and each loan's schedule. Taxes are estimated with the Income tab's rates; rental income is treated as " + (M.asm.rentalTax === "passive" ? "passive (losses carried forward)." : "able to offset other income.")));
    s.append(stmtTable(M, Y1));
    s.append(h("p", { class: "note" }, h("a", { href: "#cashflow", class: "dark-link" }, "Open the Cash Flow tab"), " to change the assumptions and see every year of the forecast."));

    // Properties
    M.props.forEach((pv) => s.append(propertyCard(M, pv, Y1)));
    if (M.soon.length) s.append(section(M.soon.join(", "), "Not switched on yet. Switch it on from the Properties tab to enter its building, rent, expenses and mortgage; it then joins this page and the forecast."));

    // Debt
    s.append(section("Debt", "Every open loan and the asset it's linked to. Payments are principal and interest; escrow is left out because taxes and insurance are counted as property expenses."));
    s.append(table([
      { label: "Loan", get: (r) => (r.total ? h("strong", {}, "Total") : h("span", {}, h("strong", {}, r.name), r.lender ? h("span", { class: "muted" }, ` ${r.lender}`) : null)) },
      { label: "Linked to", get: (r) => (r.total ? "" : r.linkedRow && BS ? ((BS.totals.assets.find((a) => a.key === r.linkedRow) || {}).name || "—") : r.secures === "other" ? "Not linked" : securedName(M, r.secures)) },
      { label: "Balance", num: 1, get: (r) => usd(r.balance) },
      { label: "Rate", num: 1, get: (r) => (r.total ? pct(r.rate / 100, 2) : `${pct(r.rate / 100, 2)}${r.floating ? " float" : ""}`) },
      { label: "Payment / month", num: 1, get: (r) => (r.payment ? usd(r.payment) : r.total ? "" : usd((r.balance * r.rate) / 1200 * (r.dayBasis === 360 ? 365 / 360 : 1)) + " int.") },
      { label: "Maturity", num: 1, get: (r) => (r.maturity ? fmtDate(r.maturity) : "—") },
      { label: "Balloon", num: 1, get: (r) => (r.balloon ? usd(r.balloon) : "—") },
      { label: "From", get: (r) => h("span", { class: "muted small" }, r.source || "") },
    ], M.debts.concat(M.debts.length ? [{ total: true, _class: "sum", balance: M.totalDebt, rate: M.totalDebt ? sum(M.debts, (d) => d.balance * d.rate) / M.totalDebt : 0 }] : [])));
    if (!M.debts.length) s.append(h("p", { class: "note" }, "No open loans are on the Admin tab."));
    s.append(h("p", { class: "note" }, `Values as of ${fmtDate(today())}. Portfolio from the ${M.pos ? fmtDate(M.pos.asOf) : "latest"} positions export; refresh it on the Upload page. Estimates for planning, not tax advice.`));
    root.replaceChildren(s);
  }

  function stmtTable(M, S) {
    const ids = S.ids.filter((id) => id !== "other" || Object.values(S.cols.other).some((v) => Math.abs(v) > 0.5));
    const line = (label, get, cls, sign = 1) => ({ label, cls, vals: ids.map((id) => sign * get(S.cols[id])), tot: sign * get(S.tot) });
    const L = [
      line("Income: distributions and rent", (c) => c.inc),
      line("Operating expenses", (c) => c.opex, null, -1),
      line("Net operating income", (c) => c.noi, "sum"),
      line("Interest", (c) => c.interest, null, -1),
      line("Principal", (c) => c.principal, null, -1),
      ...(Math.abs(S.tot.balloon) > 0.5 ? [line("Balloon payments", (c) => c.balloon, null, -1)] : []),
      ...(Math.abs(S.tot.other) > 0.5 ? [line("Other cash flows", (c) => c.other)] : []),
      line("Cash flow before taxes", (c) => c.pre, "sum"),
      line("Estimated taxes", (c) => c.tax, null, -1),
      line("Cash flow after taxes", (c) => c.net, "total"),
    ];
    return table([{ label: "", get: (r) => r.label }, ...ids.map((id, i) => ({ label: entName(M, id), num: 1, get: (r) => usd(r.vals[i]), raw: (r) => r.vals[i] })), { label: "Total", num: 1, get: (r) => h("strong", {}, usd(r.tot)), raw: (r) => r.tot }],
      L.map((l) => ({ ...l, _class: l.cls })));
  }

  function propertyCard(M, pv, Y1) {
    const wrap = h("div");
    const debts = M.debts.filter((d) => d.secures === pv.id);
    const debt = sum(debts, (d) => d.balance);
    const c = Y1.cols[pv.id];
    const ds = c.interest + c.principal; // next 12 months' debt service
    const b = pv.b;
    wrap.append(section(`${pv.name}: value and returns`, pv.src === "proforma" ? `Net operating income from the pro forma (${usd(b.grossRent)} rent, ${b.vacancyPct || 0}% vacancy, ${usd(b.opexAnnual || 0)} expenses). Switches to actual once a year of rent is in the ledger.`
      : `Net operating income from the ledger, ${fmtDate(addMonths(today(), -12))} – ${fmtDate(today())} (${pv.rentMonths} month${pv.rentMonths === 1 ? "" : "s"} of rent on file).`));
    if (!(pv.noi > 0) && !pv.value) {
      wrap.append(h("p", { class: "note" }, `Add rent and expenses (or pro forma figures) and a market cap rate on the Properties tab to value ${pv.name}.`));
      return wrap;
    }
    const V = pv.value, eq = V != null ? V - debt : null;
    wrap.append(kpis([
      { label: "Value", value: usd(V), sub: pv.valueBasis, lead: true },
      { label: "Net operating income", value: usd(pv.noi), sub: "a year, before debt" },
      { label: "Cap rate", value: pct(V ? pv.noi / V : null, 2), sub: pv.cap ? `market rate ${b.capRate}%` : "on the value shown" },
      { label: "Equity", value: usd(eq), sub: debt ? `${usd(debt)} debt, ${pct(V ? debt / V : null)} loan to value` : "no debt" },
      { label: "Debt coverage (DSCR)", value: ds ? mult(pv.noi / ds) : "—", sub: ds ? `${usd(ds)} debt service, next 12 months` : "no debt service" },
    ]));
    const cf = pv.noi - ds;
    const metrics = [
      ["Gross rent (potential)", usd(pv.potential), pv.src === "proforma" ? "pro forma" : "actual, last 12 months"],
      ["Effective gross income", usd(pv.gross), pv.src === "proforma" ? `after ${b.vacancyPct || 0}% vacancy` : "collected"],
      ["Operating expenses", usd(pv.opex), pv.gross ? `${pct(pv.opex / pv.gross)} of income` : ""],
      ["Net operating income", usd(pv.noi), ""],
      ["Cap rate on purchase price", pct(b.purchasePrice ? pv.noi / b.purchasePrice : null, 2), b.purchasePrice ? `${usd(b.purchasePrice)}${b.purchaseDate ? `, ${fmtDate(b.purchaseDate)}` : ""}` : "add the purchase price"],
      ["Cap rate on entered value", pct(b.currentValue ? pv.noi / b.currentValue : null, 2), b.currentValue ? usd(b.currentValue) : "no value entered"],
      ["Gross rent multiplier", pv.potential && V ? (V / pv.potential).toFixed(1) + "×" : "—", "value ÷ gross rent"],
      ["Debt service, next 12 months", usd(ds), debts.map((d) => d.name).join(", ") || "none"],
      ["Debt yield", pct(debt ? pv.noi / debt : null, 2), "NOI ÷ loan balance; lenders look for 8–10%+"],
      ["Cash flow after debt service", usd(cf), "NOI − principal and interest"],
      ["Cash-on-equity return", pct(eq > 0 ? cf / eq : null), "cash flow ÷ equity at today's value"],
      ["Break-even occupancy", pct(pv.potential ? (pv.opex + ds) / pv.potential : null), "share of rent needed to cover expenses and debt"],
      ...(b.squareFeet ? [["Value per square foot", usd(V && V / b.squareFeet), `${Number(b.squareFeet).toLocaleString()} sq ft`]] : []),
      ...(b.units ? [["Value per unit", usd(V && V / b.units), `${b.units} units`]] : []),
      ["Depreciation", pv.depAnnual ? `${usd(pv.depAnnual)} / yr` : "—", pv.depAnnual ? `${pv.life}-year, basis ${usd(pv.depBasis)}${pv.landAssumed ? " (land assumed 20%)" : ""}` : "add the purchase price and date"],
    ];
    wrap.append(table([{ label: "Measure", get: (r) => r[0] }, { label: "Value", num: 1, get: (r) => r[1] }, { label: "", get: (r) => h("span", { class: "muted small" }, r[2]) }], metrics));
    if (pv.noi > 0) {
      const base = pv.cap || (V ? pv.noi / V : null);
      if (base) {
        const steps = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => base + d).filter((x) => x > 0.005);
        wrap.append(h("h4", { class: "inc-head" }, "If cap rates move"));
        wrap.append(table([
          { label: "Cap rate", get: (r) => h(r.base ? "strong" : "span", {}, pct(r.cap, 2)) },
          { label: "Value", num: 1, get: (r) => usd(r.v) },
          { label: "Change", num: 1, get: (r) => (r.base ? "—" : (r.v - V >= 0 ? "+" : "") + usd(r.v - V)), raw: (r) => r.v - V },
          { label: "Equity", num: 1, get: (r) => usd(r.v - debt), raw: (r) => r.v - debt },
          { label: "Loan to value", num: 1, get: (r) => (debt ? pct(debt / r.v) : "—") },
        ], steps.map((cp) => ({ cap: cp, v: pv.noi / cp, base: Math.abs(cp - base) < 1e-9, _class: Math.abs(cp - base) < 1e-9 ? "sum" : null }))));
      }
    }
    return wrap;
  }

  /* ======================= CASH FLOW ======================= */
  async function renderCashflow(root) {
    root.replaceChildren(sheet("Cash Flow", "Loading…"));
    let ctx;
    try { ctx = await loadAll(true); } catch (e) { if (e.message !== "signed out") root.replaceChildren(sheet("Cash Flow", e.message)); return; }
    paintCashflow(root, ctx);
  }

  function paintCashflow(root, ctx) {
    const asm = A();
    const M = buildModel(ctx, asm);
    // Inputs commit on "change"; removing a focused input fires another change/blur, so repaint once, after the event.
    let queued = false;
    const rerender = () => { if (queued) return; queued = true; setTimeout(() => paintCashflow(root, ctx), 0); };
    const keepY = window.scrollY;
    const s = sheet("Cash Flow forecast", "Month by month: portfolio distributions, rent and expenses from both properties, every loan's payments, other cash flows you add, and estimated taxes. Change any assumption below and everything recalculates.");

    // horizon
    const hz = h("div", { class: "periodbar", role: "group", "aria-label": "Forecast length" }, h("span", { class: "pb-label" }, "Years"),
      [1, 2, 3, 5, 7, 10].map((y) => { const on = asm.horizon === y; return h("button", { type: "button", class: "pb" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick: () => { setDraft({ assumptions: { horizon: y } }); rerender(); } }, String(y)); }));
    s.append(h("div", { class: "periodpick" }, hz, h("p", { class: "pb-showing" }, h("strong", {}, `${ymLabel(M.months[0])} – ${ymLabel(M.months[M.months.length - 1])}`), ` · ${M.months.length} months`)));

    s.append(assumptionsPanel(M, rerender));

    const Y1 = statement(M, 0, 12), ALL = statement(M, 0, M.rows.length);
    const last = M.rows[M.rows.length - 1];
    const low = M.rows.reduce((a, r) => (r.net < a.net ? r : a), M.rows[0]);
    s.append(kpis([
      { label: "After-tax cash flow, first 12 months", value: usd(Y1.tot.net), sub: `${usd(Y1.tot.net / Math.min(12, M.rows.length))} a month`, lead: true },
      { label: `After-tax cash flow, ${asm.horizon} year${asm.horizon > 1 ? "s" : ""}`, value: usdK(ALL.tot.net), sub: `${usdK(ALL.tot.tax)} estimated taxes` },
      { label: "Cash at the end", value: usdK(last.cash), sub: asm.marginMode === "paydown" ? `after ${usdK(sum(M.rows, (r) => r.paydown))} of margin repaid` : "if nothing is spent or reinvested" },
      { label: "Net worth", value: usdK(last.netWorth), sub: `from ${usdK(M.netWorth)} today`, lead: true },
      { label: "Weakest month", value: usd(low.net), sub: `${ymLabel(low.ym)}${low.balloon ? " (balloon)" : low.tax > Y1.tot.tax / 6 ? " (tax payment)" : ""}` },
    ]));

    // Annual chart
    const years = [...new Set(M.rows.map((r) => r.year))];
    const yr = years.map((y) => {
      const rs = M.rows.filter((r) => r.year === y);
      const f = (k) => sum(rs, (r) => r[k]);
      return { y, n: rs.length, port: f("portIncome"), rent: f("rent"), opex: f("opex"), interest: f("interest"), principal: f("principal"), balloon: f("balloon"), custom: f("custom"), tax: f("tax"), net: f("net"), end: rs[rs.length - 1] };
    });
    s.append(section("Year by year", "Bars above zero bring cash in; bars below take it out. The line is what's left after taxes."));
    const { box: b1, canvas: c1 } = chartBox(320);
    s.append(b1);
    const posCustom = yr.map((x) => Math.max(x.custom, 0)), negCustom = yr.map((x) => Math.min(x.custom, 0));
    draw(c1, { type: "bar", data: { labels: yr.map((x) => (x.n < 12 ? `${x.y} (${x.n} mo)` : x.y)), datasets: [
      { label: "Portfolio distributions", data: yr.map((x) => x.port), backgroundColor: C.green, stack: "c" },
      { label: "Rent", data: yr.map((x) => x.rent), backgroundColor: C.gold, stack: "c" },
      ...(posCustom.some((v) => v) ? [{ label: "Other inflows", data: posCustom, backgroundColor: C.haze, stack: "c" }] : []),
      { label: "Operating expenses", data: yr.map((x) => -x.opex), backgroundColor: C.plum, stack: "c" },
      { label: "Interest", data: yr.map((x) => -x.interest), backgroundColor: C.bronze, stack: "c" },
      { label: "Principal", data: yr.map((x) => -x.principal), backgroundColor: C.slate, stack: "c" },
      ...(yr.some((x) => x.balloon) ? [{ label: "Balloons", data: yr.map((x) => -x.balloon), backgroundColor: "#3b2f5c", stack: "c" }] : []),
      ...(negCustom.some((v) => v) ? [{ label: "Other outflows", data: negCustom, backgroundColor: C.grey, stack: "c" }] : []),
      { label: "Estimated taxes", data: yr.map((x) => -x.tax), backgroundColor: C.red, stack: "c" },
      { type: "line", label: "After-tax cash flow", data: yr.map((x) => x.net), borderColor: C.navy, backgroundColor: C.navy, borderWidth: 2.5, pointRadius: 4, order: -1 },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { tooltip: { filter: (c) => !!c.raw, callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } } });

    // Annual table
    const tl = (label, get, cls, sign = 1) => ({ label, _class: cls, vals: yr.map((x) => sign * get(x)), tot: sign * sum(yr, get) });
    const lines = [
      tl("Portfolio distributions", (x) => x.port), tl("Rent", (x) => x.rent), tl("Operating expenses", (x) => x.opex, null, -1),
      tl("Interest (margin and mortgages)", (x) => x.interest, null, -1), tl("Principal", (x) => x.principal, null, -1),
      ...(yr.some((x) => x.balloon) ? [tl("Balloon payments", (x) => x.balloon, null, -1)] : []),
      ...(yr.some((x) => x.custom) ? [tl("Other cash flows", (x) => x.custom)] : []),
      tl("Cash flow before taxes", (x) => x.net + x.tax, "sum"), tl("Estimated taxes", (x) => x.tax, null, -1), tl("Cash flow after taxes", (x) => x.net, "total"),
    ];
    s.append(table([{ label: "", get: (r) => r.label }, ...yr.map((x, i) => ({ label: x.n < 12 ? `${x.y}*` : x.y, num: 1, get: (r) => usd(r.vals[i]), raw: (r) => r.vals[i] })), { label: "Total", num: 1, get: (r) => h("strong", {}, usd(r.tot)), raw: (r) => r.tot }], lines));
    if (yr.some((x) => x.n < 12)) s.append(h("p", { class: "note" }, "* Partial year inside the forecast window."));

    // Monthly chart
    s.append(section("Month by month", "Monthly after-tax cash flow, and the cash it builds up over time."));
    const { box: b2, canvas: c2 } = chartBox(280);
    s.append(b2);
    draw(c2, { type: "bar", data: { labels: M.rows.map((r) => `${MON[+r.ym.slice(5) - 1]} '${r.ym.slice(2, 4)}`), datasets: [
      { label: "After-tax cash flow", data: M.rows.map((r) => r.net), backgroundColor: M.rows.map((r) => (r.net < 0 ? C.red : C.green)), yAxisID: "y" },
      { type: "line", label: "Cumulative cash", data: M.rows.map((r) => r.cash), borderColor: C.navy, backgroundColor: C.navy, borderWidth: 2, pointRadius: 0, yAxisID: "y2" },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } },
      scales: { y: { position: "left", ticks: { callback: moneyTick } }, y2: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: moneyTick } } } } });

    // Net worth
    s.append(section("Net worth path", `Portfolio grows ${asm.priceGrowth}% a year, real estate ${asm.valueGrowth}% a year; loans follow their schedules and cash builds from the forecast.`));
    const { box: b3, canvas: c3 } = chartBox(300);
    s.append(b3);
    const pts = [{ label: "Today", port: M.mv0 + (M.pos && M.pos.cash > 0 ? M.pos.cash : 0), prop: sum(M.props, (p) => p.value || 0), cash: (asm.startCash || 0) + (M.otherAssets || 0), debt: M.totalDebt, nw: M.netWorth }]
      .concat(yr.map((x) => ({ label: x.y, port: x.end.portValue, prop: x.end.propValue, cash: x.end.cash + (M.otherAssets || 0), debt: x.end.debtBal, nw: x.end.netWorth })));
    draw(c3, { type: "bar", data: { labels: pts.map((p) => (p.label === "Today" ? "Today" : `End ${p.label}`)), datasets: [
      { label: "Portfolio", data: pts.map((p) => p.port), backgroundColor: C.green, stack: "n" },
      { label: "Real estate", data: pts.map((p) => p.prop), backgroundColor: C.gold, stack: "n" },
      { label: "Cash", data: pts.map((p) => Math.max(p.cash, 0)), backgroundColor: C.haze, stack: "n" },
      { label: "Debt", data: pts.map((p) => -p.debt - Math.min(p.cash, 0)), backgroundColor: C.slate, stack: "n" },
      { type: "line", label: "Net worth", data: pts.map((p) => p.nw), borderColor: C.navy, backgroundColor: C.navy, borderWidth: 2.5, pointRadius: 4, order: -1 },
    ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } } });

    // Taxes
    s.append(section("Estimated taxes by year", `Portfolio distributions taxed at ${pct(M.PT.rate)} (${M.PT.basis}). Margin interest is deducted against investment income. Rental income is taxed after mortgage interest and depreciation${asm.rentalTax === "passive" ? "; a rental loss is carried forward against future rental income" : "; rental losses reduce other taxable income"}.`));
    const TY = years.map((y) => M.tax.byYear[y]);
    const tline = (label, get, cls) => ({ label, _class: cls, vals: TY.map(get), tot: sum(TY, get) });
    s.append(table([{ label: "", get: (r) => r.label }, ...TY.map((t, i) => ({ label: t.months < 12 ? `${t.year}*` : t.year, num: 1, get: (r) => (r.pctRow ? pct(r.vals[i]) : usd(r.vals[i])), raw: (r) => r.vals[i] })), { label: "Total", num: 1, get: (r) => (r.pctRow ? "" : usd(r.tot)), raw: (r) => r.tot }], [
      tline("Portfolio distributions", (t) => t.port), tline("Tax on distributions", (t) => t.portTax),
      tline("Margin interest deduction (tax saved)", (t) => -t.intSave),
      tline("Rental income after interest and depreciation", (t) => t.rentalNet),
      ...(asm.rentalTax === "passive" ? [tline("Passive loss carried at year end", (t) => t.carryEnd)] : []),
      tline("Tax on rental income", (t) => t.rentalTax),
      ...(TY.some((t) => t.custTax) ? [tline("Tax on other cash flows", (t) => t.custTax)] : []),
      tline("Estimated taxes", (t) => t.total, "total"),
    ]));

    // Custom cash flows
    s.append(itemsEditor(M, rerender));

    // Monthly detail
    const det = h("details", { class: "lots" }, h("summary", {}, `Every month (${M.rows.length})`));
    det.append(table([
      { label: "Month", get: (r) => ymLabel(r.ym) },
      { label: "Distributions", num: 1, get: (r) => usd(r.portIncome) }, { label: "Rent", num: 1, get: (r) => usd(r.rent) },
      { label: "Expenses", num: 1, get: (r) => usd(-r.opex), raw: (r) => -r.opex }, { label: "Interest", num: 1, get: (r) => usd(-r.interest), raw: (r) => -r.interest },
      { label: "Principal", num: 1, get: (r) => usd(-r.principal - r.balloon), raw: (r) => -r.principal - r.balloon },
      { label: "Other", num: 1, get: (r) => (r.custom ? usd(r.custom) : "—"), raw: (r) => r.custom },
      { label: "Taxes", num: 1, get: (r) => usd(-r.tax), raw: (r) => -r.tax },
      { label: "After tax", num: 1, get: (r) => h("strong", {}, usd(r.net)), raw: (r) => r.net },
      { label: "Cash", num: 1, get: (r) => usd(r.cash), raw: (r) => r.cash },
      { label: "Debt", num: 1, get: (r) => usd(r.debtBal) },
    ], M.rows));
    s.append(det);

    s.append(section("What's in the forecast"), h("ul", { class: "jason" },
      h("li", {}, `Portfolio: ${usd(M.inc0)} a year of distributions from ${M.incBasis || "no portfolio data"}, growing ${asm.incomeGrowth}% a year. Holdings aren't traded; distributions are taken as cash${asm.marginMode === "paydown" ? " and any surplus repays margin" : ""}.`),
      ...M.props.map((p) => h("li", {}, p.gross || p.opex ? `${p.name}: ${usd(p.gross)} rent and ${usd(p.opex)} expenses a year (${p.src === "proforma" ? "pro forma" : "actual, last 12 months"}), stepping up ${asm.rentGrowth}% and ${asm.expenseGrowth}% each year.` : `${p.name}: no rent or expenses yet. Add them, or pro forma figures, on the Properties tab.`)),
      h("li", {}, `Loans: ${M.debts.length} open. Amortizing loans follow their schedules${asm.refiBalloons ? "; balloons are assumed refinanced on the same terms" : "; balloons are paid in full when due"}. Floating rates ${asm.fedShift ? `move ${asm.fedShift > 0 ? "+" : ""}${asm.fedShift}% from` : "stay at"} today's Fed Funds level.`),
      h("li", {}, `Taxes: Income tab rates (${pct(M.R.ordinary)} ordinary all-in). Taxes are ${asm.taxTiming === "quarterly" ? "paid as quarterly estimates in April, June, September and January" : "set aside evenly each month"}. These are estimates of the tax on these sources only, not a full return.`)));

    root.replaceChildren(s);
    window.scrollTo({ top: keepY });
  }

  function assumptionsPanel(M, rerender) {
    const a = A();
    const dirty = !!(draft && (Object.keys(draft.assumptions || {}).length || draft.items));
    const det = h("details", { class: "bm-details" }, h("summary", {}, `Assumptions${dirty ? " (changed, not saved)" : saved && saved.updatedBy ? `, saved by ${saved.updatedBy.split("@")[0]}` : ""}`));
    if (dirty) det.open = true;
    const numIn = (key, label, step, hint) => {
      const el = h("input", { type: "number", step, value: a[key] });
      el.addEventListener("change", () => { const v = Number(el.value) || 0; if (v === a[key]) return; setDraft({ assumptions: { [key]: v } }); rerender(); });
      return field(label, el, hint);
    };
    const pick = (key, label, opts, hint) => {
      const el = h("select", { class: "ws-select" }, opts.map(([v, l]) => { const o = h("option", { value: String(v) }, l); if (String(a[key]) === String(v)) o.selected = true; return o; }));
      el.addEventListener("change", () => { const v = el.value === "true" ? true : el.value === "false" ? false : el.value; setDraft({ assumptions: { [key]: v } }); rerender(); });
      return field(label, el, hint);
    };
    det.append(
      h("h4", { class: "inc-head" }, "Portfolio"),
      h("div", { class: "tax-form" },
        numIn("incomeGrowth", "Distribution growth % / yr", "0.5", `Starts at ${usd(M.inc0)} a year`),
        numIn("priceGrowth", "Market value growth % / yr", "0.5", "For net worth only"),
        pick("marginMode", "Surplus cash", [["hold", "Keep as cash"], ["paydown", "Repay the margin loan"]]),
        numIn("fedShift", "Change in floating rates (points)", "0.25", "e.g. −0.5 if the Fed cuts twice")),
      h("h4", { class: "inc-head" }, "Real estate"),
      h("div", { class: "tax-form" },
        numIn("rentGrowth", "Rent growth % / yr", "0.5"), numIn("expenseGrowth", "Expense growth % / yr", "0.5"), numIn("valueGrowth", "Property value growth % / yr", "0.5"),
        pick("refiBalloons", "Balloon payments", [[true, "Refinance on the same terms"], [false, "Pay in full when due"]])),
      h("h4", { class: "inc-head" }, "Taxes and cash"),
      h("div", { class: "tax-form" },
        pick("rentalTax", "Rental income", [["passive", "Passive: losses carried forward"], ["offset", "Losses offset other income"]]),
        numIn("priorPassiveLoss", "Suspended passive losses from prior years $", "100"),
        pick("taxTiming", "Tax timing", [["monthly", "Set aside each month"], ["quarterly", "Quarterly estimates"]]),
        numIn("startCash", "Other cash on hand today $", "1000")),
      h("p", { class: "note" }, "Tax rates come from the Income tab's tax assumptions. Property rent, expenses, cap rates and depreciation inputs are on the Properties tab; loans on the Admin tab."));
    const msg = h("span", { class: "note inline", role: "status" });
    const saveBtn = h("button", { type: "button", class: "btn-small", disabled: !dirty }, "Save as default for both of you");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true; msg.textContent = "Saving…";
      try { saved = await api("/api/plan", { version: saved ? saved.version : 0, assumptions: A(), items: items() }); draft = null; rerender(); }
      catch (e) { if (e.data) { saved = e.data; } msg.textContent = e.message; saveBtn.disabled = false; }
    });
    const reset = h("button", { type: "button", class: "link-button dark", disabled: !dirty }, "Discard changes");
    reset.addEventListener("click", () => { draft = null; rerender(); });
    det.append(h("div", { class: "toolbar" }, saveBtn, reset, msg));
    return det;
  }

  function itemsEditor(M, rerender) {
    const wrap = section("Other cash flows", "Anything else to plan for: draws, a roof, a property tax appeal refund, a capital call. Positive amounts come in, negative go out. They're included above and saved with the assumptions.");
    const list = items().slice();
    const commit = (next) => { setDraft({ items: next }); rerender(); };
    const ents = [["other", "Other"], ["portfolio", "Portfolio"], ...M.props.map((p) => [p.id, p.name])];
    const FREQ = [["once", "Once"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annually", "Yearly"]];
    const TAXO = [["none", "Not taxable"], ["ordinary", "Taxable income"], ["deductible", "Deductible expense"]];
    if (list.length) wrap.append(table([
      { label: "On", get: (r) => { const c = h("input", { type: "checkbox" }); c.checked = r.on !== false; c.addEventListener("change", () => commit(list.map((x) => (x === r ? { ...x, on: c.checked } : x)))); return c; } },
      { label: "Name", get: (r) => r.name },
      { label: "Amount", num: 1, get: (r) => usd(r.amount), raw: (r) => r.amount },
      { label: "How often", get: (r) => (FREQ.find((f) => f[0] === r.freq) || [0, r.freq])[1] },
      { label: "From", num: 1, get: (r) => fmtDate(r.start) }, { label: "Until", num: 1, get: (r) => (r.end ? fmtDate(r.end) : r.freq === "once" ? "—" : "ongoing") },
      { label: "Growth", num: 1, get: (r) => (r.growth ? `${r.growth}%` : "—") },
      { label: "Tax", get: (r) => (TAXO.find((f) => f[0] === r.tax) || [0, ""])[1] },
      { label: "Belongs to", get: (r) => (ents.find((e) => e[0] === r.entity) || [0, "Other"])[1] },
      { label: "", get: (r) => h("button", { type: "button", class: "link-button danger", onclick: () => commit(list.filter((x) => x !== r)) }, "Remove") },
    ], list));
    const I = {
      name: h("input", { placeholder: "e.g. Roof replacement" }), amount: h("input", { type: "number", step: "100", placeholder: "−25000" }),
      freq: h("select", { class: "ws-select" }, FREQ.map(([v, l]) => h("option", { value: v }, l))),
      start: h("input", { type: "date", value: `${M.startYM}-01` }), end: h("input", { type: "date" }),
      growth: h("input", { type: "number", step: "0.5", value: "0" }),
      tax: h("select", { class: "ws-select" }, TAXO.map(([v, l]) => h("option", { value: v }, l))),
      entity: h("select", { class: "ws-select" }, ents.map(([v, l]) => h("option", { value: v }, l))),
    };
    const add = h("button", { type: "button", class: "btn-small" }, "Add");
    const err = h("span", { class: "note inline warn-text" });
    add.addEventListener("click", () => {
      const amount = Number(I.amount.value);
      if (!I.name.value.trim() || !amount || !I.start.value) { err.textContent = "Enter a name, an amount and a start date."; return; }
      commit(list.concat([{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: I.name.value.trim(), amount, freq: I.freq.value, start: I.start.value, end: I.end.value || null, growth: Number(I.growth.value) || 0, tax: I.tax.value, entity: I.entity.value, on: true }]));
    });
    wrap.append(h("details", { class: "ws-add", open: !list.length }, h("summary", {}, "Add a cash flow"),
      h("div", { class: "tax-form" }, field("Name", I.name), field("Amount $", I.amount, "Negative for money out"), field("How often", I.freq), field("Starting", I.start), field("Until (optional)", I.end), field("Growth % / yr", I.growth), field("Tax treatment", I.tax), field("Belongs to", I.entity)),
      h("div", { class: "toolbar" }, add, err)));
    return wrap;
  }

  window.BSWealth = {
    tabs: [{ slug: "overview", name: "Overview" }, { slug: "cashflow", name: "Cash Flow" }],
    render(slug, root) { (slug === "overview" ? renderOverview : renderCashflow)(root); },
    invalidate() { cache = null; },
  };
})();
