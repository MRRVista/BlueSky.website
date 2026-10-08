// Overview balance sheet: assets on top, liabilities below, net worth at the bottom. Rows come from the
// Schwab account, the properties, the Admin-tab loans and the Inputs accounts, plus anything added here by
// hand or from Plaid. Add, remove, drag to reorder, tag to a Plaid account, and link each liability to the
// asset it's against. Everything is saved for both users (/api/balance).
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 1) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
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
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Something went wrong. Try again."); e.data = d.data; throw e; }
    return d;
  };

  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.bs-wrap { margin-top: 0.25rem; }
.bs-table td, .bs-table th { vertical-align: middle; }
.bs-table td.bs-h { width: 1.6rem; padding-right: 0; color: #9aa7bb; cursor: grab; user-select: none; white-space: nowrap; }
.bs-table tr.dragging { opacity: 0.45; }
.bs-table tr.drop-before td { box-shadow: inset 0 2px 0 var(--gold); }
.bs-name strong { font-weight: 500; color: #0c1c36; }
.bs-type { display: inline-block; margin-left: 0.4rem; font-size: 0.7rem; letter-spacing: 0.02em; padding: 0.05rem 0.45rem; border-radius: 999px; background: #eef1f6; color: #4a5b78; vertical-align: middle; }
.bs-src { display: inline-block; margin-left: 0.3rem; font-size: 0.7rem; padding: 0.05rem 0.45rem; border-radius: 999px; background: #e9f3ec; color: #2e6b45; vertical-align: middle; }
.bs-src.manual { background: #f3eee4; color: #7a5a1e; }
.bs-auto { display: block; font-size: 0.78rem; color: #7a5a00; margin-top: 0.15rem; }
.bs-auto button { margin-left: 0.35rem; }
.bs-gap { height: 1.4rem; }
.bs-nw { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin: 0.9rem 0 0.4rem; padding: 0.8rem 1rem; background: #0c1c36; color: #eef3f8; border-radius: 8px; }
.bs-nw strong { font-size: 1.35rem; font-weight: 400; color: var(--gold); font-variant-numeric: tabular-nums; }
.bs-nw .neg { color: #ffb4a8; }
.bs-nw small { color: rgba(238,243,248,.72); }
.bs-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.6rem 0 0.2rem; }
.bs-mv { display: inline-flex; flex-direction: column; vertical-align: middle; margin-left: 0.2rem; }
.bs-mv button { font-size: 0.6rem; line-height: 1; padding: 0.05rem 0.25rem; border: 1px solid #d5dde9; background: #fff; color: #4a5b78; border-radius: 3px; cursor: pointer; }
.bs-mv button + button { margin-top: 1px; }
.bs-form { background: #f7f9fc; border: 1px solid #e3e9f2; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.4rem 0 0.8rem; }
.bs-form .ws-row { margin-bottom: 0.4rem; }
.bs-ready li { margin: 0.25rem 0; }
.bs-sel { font: inherit; font-size: 0.84rem; max-width: 12rem; border: 1px solid #c9d4e3; border-radius: 4px; padding: 0.2rem 0.3rem; background: #fff; }
.bs-actions { white-space: nowrap; }
` }));

  /* ---------------- data ---------------- */
  let data = null;
  async function load(force) {
    if (data && !force) return data;
    data = await api("/api/balance");
    return data;
  }
  const typeOf = (id) => { for (const g of (data && data.groups) || []) for (const [tid, label] of g.t) if (tid === id) return { id, label, group: g.g, side: g.side }; return null; };
  const typeSelect = (side, value, onchange) => {
    const s = h("select", { class: "ws-select" });
    for (const g of data.groups.filter((x) => x.side === side)) {
      const og = h("optgroup", { label: g.g });
      g.t.forEach(([id, label]) => { const o = h("option", { value: id }, label); if (id === value) o.selected = true; og.append(o); });
      s.append(og);
    }
    if (onchange) s.addEventListener("change", onchange);
    return s;
  };
  const plaidLabel = (a) => `${a.institution} · ${a.shortName || a.name} …${a.mask}${a.current != null ? ` · ${usd(a.current)}` : ""}`;

  // Row key for each forecast debt, and the forecast entity each asset row stands for.
  const debtKey = (d) => (String(d.id).startsWith("pm-") ? `sys:pm:${d.id.slice(3)}` : d.id === "margin-implied" ? "sys:margin" : String(d.id).startsWith("m:") ? d.id : `sys:loan:${d.id}`);
  const entityOf = (assetKey) => (assetKey === "sys:portfolio" ? "portfolio" : assetKey && assetKey.startsWith("sys:prop:") ? assetKey.slice(9) : "other");

  // Called from the model: drop removed loans, use Plaid balances where tagged, and add liabilities entered here.
  function adjustDebts(debts) {
    if (!data) return debts;
    const hidden = new Set(data.balance.hidden || []);
    const plaid = Object.fromEntries(data.plaid.map((a) => [a.id, a]));
    const rows = data.balance.rows || {};
    const out = [];
    for (const d of debts) {
      const k = debtKey(d);
      if (hidden.has(k)) continue;
      const r = rows[k] || {};
      const a = r.plaidAccountId && plaid[r.plaidAccountId];
      const x = { ...d, key: k };
      if (a && a.current != null) { x.balance = a.current; x.source = `Plaid ${a.institution} …${a.mask}; terms from ${d.source}`; x.plaid = true; }
      if (r.linkedTo && d.secures === "other") x.secures = entityOf(r.linkedTo), x.linkedRow = r.linkedTo;
      out.push(x);
    }
    for (const [k, r] of Object.entries(rows)) {
      if (!k.startsWith("m:") || r.side !== "liability" || hidden.has(k)) continue;
      const a = r.plaidAccountId && plaid[r.plaidAccountId];
      const bal = a ? a.current : r.value;
      if (!(bal > 0)) continue;
      const rate = r.rate != null ? r.rate : a && a.liability && a.liability.rate != null ? a.liability.rate : 0;
      out.push({ id: k, key: k, name: r.name, lender: a ? a.institution : null, kind: "interest-only", floating: false, rate, baseRate: rate, secures: entityOf(r.linkedTo), linkedRow: r.linkedTo,
        guessed: false, balance: bal, source: a ? `Plaid ${a.institution} …${a.mask}` : `entered${r.asOf ? ` ${fmtDate(r.asOf)}` : ""}`, escrow: 0, plaid: !!a });
    }
    return out;
  }

  // Every row with its value, in saved order.
  function compute(M) {
    const B = data, hidden = new Set(B.balance.hidden || []);
    const plaid = Object.fromEntries(B.plaid.map((a) => [a.id, a]));
    const stored = B.balance.rows || {};
    const list = [];
    const add = (base) => {
      // Saved type, name, tag and link win; the computed value and its basis always come from the data.
      const r = { ...base, ...(stored[base.key] || {}) };
      for (const k of ["value", "basis", "src", "rate", "debt", "missing", "manual", "archived"]) if (k in base) r[k] = base[k];
      r.typeInfo = typeOf(r.type) || { label: "", group: "" };
      r.hidden = hidden.has(r.key);
      r.plaidAcct = r.plaidAccountId ? plaid[r.plaidAccountId] || null : null;
      list.push(r);
    };
    for (const s of B.system) {
      if (s.key === "sys:portfolio") {
        if (!M.pos) continue;
        const v = M.mv0 + Math.max(M.pos.cash || 0, 0);
        add({ ...s, value: v, basis: `${M.pos.holdings.length} holdings, ${fmtDate(M.pos.asOf)} positions${M.pos.source === "plaid" ? " (Plaid)" : ""}`, src: "Positions" });
      } else if (s.key.startsWith("sys:prop:")) {
        const pv = M.props.find((p) => p.id === s.key.slice(9));
        if (!pv && !s.archived) continue;
        add({ ...s, value: pv ? pv.value || 0 : 0, basis: pv ? (pv.value ? pv.valueBasis : "no value yet: add a cap rate or value on the Properties tab") : "removed", missing: pv && !pv.value, src: "Properties" });
      } else if (s.key.startsWith("sys:acct:")) {
        const r0 = stored[s.key] || {};
        const a = r0.plaidAccountId && plaid[r0.plaidAccountId];
        add({ ...s, value: a && a.current != null ? a.current : s.value || 0, basis: a ? `Plaid ${fmtDate(today())}` : `${s.source === "plaid" ? "Plaid" : "entered"} ${fmtDate(s.asOf)}`, src: "Inputs" });
      } else if (s.side === "liability") {
        const d = M.debts.find((x) => x.key === s.key);
        if (!d && !hidden.has(s.key)) continue;
        add({ ...s, value: d ? d.balance : 0, rate: d ? d.rate : null, basis: d ? d.source : "removed", debt: d, src: s.key.startsWith("sys:pm:") ? "Properties" : "Admin" });
      }
    }
    const marg = M.debts.find((d) => d.key === "sys:margin");
    if (marg || hidden.has("sys:margin")) add({ key: "sys:margin", side: "liability", type: "margin", name: "Schwab margin loan", value: marg ? marg.balance : 0, rate: marg && marg.rate, basis: marg ? marg.source : "removed", debt: marg, src: "Positions" });
    if (M.asm.startCash) add({ key: "sys:cash", side: "asset", type: "checking", name: "Other cash", value: M.asm.startCash, basis: "Cash Flow assumptions", src: "Cash Flow" });
    for (const [k, r] of Object.entries(stored)) {
      if (!k.startsWith("m:")) continue;
      const a = r.plaidAccountId && plaid[r.plaidAccountId];
      const v = a ? a.current : r.value;
      const d = r.side === "liability" ? M.debts.find((x) => x.key === k) : null;
      add({ key: k, side: r.side, type: r.type, name: r.name, value: v || 0, rate: d ? d.rate : r.rate, basis: a ? `Plaid ${a.institution} …${a.mask}${a.liability && a.liability.nextDue ? `, next payment due ${fmtDate(a.liability.nextDue)}` : ""}` : `entered${r.asOf ? ` ${fmtDate(r.asOf)}` : ""}`, src: a ? "Plaid" : "Manual", manual: true });
    }
    // Linked liabilities against each asset.
    const linkOf = (r) => {
      if (r.key === "sys:margin") return "sys:portfolio";
      if (r.key.startsWith("sys:pm:")) return `sys:prop:${r.key.slice(7)}`;
      if (r.key.startsWith("sys:loan:") && r.debt) return r.debt.linkedRow || (r.debt.secures === "portfolio" ? "sys:portfolio" : r.debt.secures && r.debt.secures !== "other" ? `sys:prop:${r.debt.secures}` : null);
      return r.linkedTo || null;
    };
    list.forEach((r) => { if (r.side === "liability") r.link = linkOf(r); });
    // Order: saved order first, anything new after it.
    const sides = { asset: [], liability: [] };
    for (const side of ["asset", "liability"]) {
      const ord = (B.balance.order && B.balance.order[side]) || [];
      const mine = list.filter((r) => r.side === side);
      mine.sort((a, b) => { const ia = ord.indexOf(a.key), ib = ord.indexOf(b.key); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); });
      sides[side] = mine;
    }
    const assets = sides.asset.filter((r) => !r.hidden), liabs = sides.liability.filter((r) => !r.hidden);
    assets.forEach((a) => { a.debt = sum(liabs.filter((l) => l.link === a.key), (l) => l.value); a.equity = a.value - a.debt; });
    const totalAssets = sum(assets, (a) => a.value), totalLiab = sum(liabs, (l) => l.value);
    return { assets, liabs, removed: list.filter((r) => r.hidden), totalAssets, totalLiab, netWorth: totalAssets - totalLiab, unlinked: liabs.filter((l) => !l.link) };
  }

  /* ---------------- render ---------------- */
  function render(M, rerender, toast) {
    const T = compute(M);
    const wrap = h("div", { class: "bs-wrap" });
    const run = async (body, msg) => {
      try { data = await api("/api/balance", { ...body, version: data.balance.version }); window.dispatchEvent(new CustomEvent("bs:data-changed", { detail: ["balance", "properties", "loans", "inputs"] })); if (msg) toast(msg); rerender(); }
      catch (e) { if (e.data) data = e.data; if (e.message !== "signed out") toast(e.message, "err"); }
    };
    const shareNW = (r) => (T.netWorth ? r.equity / T.netWorth : null);

    // ----- assets
    const atab = rowsTable("asset", T.assets, [
      { label: "Value", num: 1, get: (r) => usd(r.value) },
      { label: "Debt against it", num: 1, get: (r) => (r.debt ? usd(-r.debt) : "—"), neg: (r) => r.debt > 0 },
      { label: "Equity", num: 1, get: (r) => usd(r.equity), neg: (r) => r.equity < 0 },
      { label: "Loan to value", num: 1, get: (r) => (r.value && r.debt ? pct(r.debt / r.value) : "—") },
      { label: "Share of net worth", num: 1, get: (r) => pct(shareNW(r)) },
      { label: "Value basis", get: (r) => h("span", { class: "muted small" }, r.basis || "") },
    ], { label: "Total assets", cells: [usd(T.totalAssets), T.totalLiab ? usd(-sum(T.assets, (a) => a.debt)) : "—", usd(sum(T.assets, (a) => a.equity)), "", T.netWorth ? "100.0%" : "—", ""] }, run);
    wrap.append(h("h4", { class: "inc-head" }, "Assets"), atab, h("div", { class: "bs-bar" }, h("button", { type: "button", class: "btn-small", onclick: () => openAdd("asset") }, "+ Add asset")));
    const addBoxA = h("div"); wrap.append(addBoxA);

    wrap.append(h("div", { class: "bs-gap" }));

    // ----- liabilities
    const assetOpts = [["", "Not linked"]].concat(T.assets.map((a) => [a.key, a.name]));
    const ltab = rowsTable("liability", T.liabs, [
      { label: "Balance", num: 1, get: (r) => usd(-r.value), neg: (r) => r.value > 0 },
      { label: "Linked to", get: (r) => {
        if (r.key === "sys:margin" || r.key.startsWith("sys:pm:")) return h("span", { class: "muted small" }, (T.assets.find((a) => a.key === r.link) || {}).name || "—");
        const s = h("select", { class: "bs-sel", "aria-label": `What ${r.name} is against` }, assetOpts.map(([v, l]) => { const o = h("option", { value: v }, l); if ((r.link || "") === v) o.selected = true; return o; }));
        s.addEventListener("change", () => run({ op: "link", key: r.key, linkedTo: s.value || null }, "Linked."));
        return s;
      } },
      { label: "Rate", num: 1, get: (r) => (r.rate != null && r.rate !== 0 ? pct(r.rate / 100, 2) : "—") },
      { label: "Source", get: (r) => h("span", { class: "muted small" }, r.basis || "") },
    ], { label: "Total liabilities", cells: [usd(-T.totalLiab), "", "", ""] }, run);
    wrap.append(h("h4", { class: "inc-head" }, "Liabilities"), ltab, h("div", { class: "bs-bar" }, h("button", { type: "button", class: "btn-small", onclick: () => openAdd("liability") }, "+ Add liability")));
    const addBoxL = h("div"); wrap.append(addBoxL);

    wrap.append(h("div", { class: "bs-nw" }, h("span", {}, "Net worth ", h("small", {}, `${usd(T.totalAssets)} assets − ${usd(T.totalLiab)} liabilities`)), h("strong", { class: T.netWorth < 0 ? "neg" : null }, usd(T.netWorth))));

    // ----- Plaid accounts not on the balance sheet yet
    const ready = data.plaid.filter((a) => !a.row && !a.dismissed);
    if (ready.length) {
      const d = h("details", { class: "ws-add", open: ready.length <= 6 ? true : null }, h("summary", {}, `Plaid accounts ready to add (${ready.length})`));
      const ul = h("ul", { class: "bs-ready" });
      ready.forEach((a) => {
        const t = typeOf(a.suggestedType);
        ul.append(h("li", {}, `${plaidLabel(a)} `, h("span", { class: "muted small" }, `→ ${a.suggestedSide === "liability" ? "Liability" : "Asset"}, ${t ? t.label : ""} `),
          h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "add", row: { side: a.suggestedSide, type: a.suggestedType, plaidAccountId: a.id } }, "Added.") }, "Add"), " · ",
          h("button", { type: "button", class: "link-button dark", onclick: () => openAdd(a.suggestedSide, a) }, "Add as…"), " · ",
          h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "dismiss", plaidAccountId: a.id }) }, "Not on the balance sheet")));
      });
      d.append(ul);
      const dis = data.plaid.filter((a) => a.dismissed && !a.row);
      if (dis.length) d.append(h("p", { class: "note" }, `Kept off the balance sheet: `, dis.map((a, i) => [i ? ", " : "", h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "dismiss", plaidAccountId: a.id, undo: true }) }, `${a.shortName || a.name} …${a.mask}`)])));
      wrap.append(d);
    }
    if (T.removed.length) {
      const d = h("details", { class: "ws-add" }, h("summary", {}, `Removed from the balance sheet (${T.removed.length})`));
      d.append(h("ul", {}, T.removed.map((r) => h("li", {}, `${r.name} `, h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "restore", key: r.key }, "Restored.") }, "Restore")))));
      d.append(h("p", { class: "note" }, "Removing a property hides it here and on the Properties tab; its ledger, leases and history are kept."));
      wrap.append(d);
    }

    // ----- add form
    function openAdd(side, plaidAcct) {
      const box = side === "asset" ? addBoxA : addBoxL;
      if (box.firstChild && !plaidAcct) { box.replaceChildren(); return; }
      const avail = data.plaid.filter((a) => (!a.row || a.id === (plaidAcct && plaidAcct.id)) && (a.suggestedSide === side || a.id === (plaidAcct && plaidAcct.id)));
      const src = h("select", { class: "ws-select" }, h("option", { value: "manual" }, "Enter by hand"), avail.length ? h("option", { value: "plaid" }, "A Plaid account") : null);
      const pSel = h("select", { class: "ws-select" }, avail.map((a) => h("option", { value: a.id }, plaidLabel(a))));
      const name = h("input", { type: "text", placeholder: side === "asset" ? "e.g. 1200 Oak Street" : "e.g. Chase Sapphire" });
      const value = h("input", { type: "number", step: "0.01", min: "0", placeholder: side === "asset" ? "value" : "amount owed" });
      const asOf = h("input", { type: "date", value: today() });
      const rate = h("input", { type: "number", step: "0.01", min: "0", placeholder: "e.g. 7.25" });
      let typeSel = typeSelect(side, side === "asset" ? "checking" : "cc");
      const link = h("select", { class: "ws-select" }, assetOpts.map(([v, l]) => h("option", { value: v }, l)));
      const note = h("p", { class: "note" });
      const sync = () => {
        const isP = src.value === "plaid";
        pSel.parentElement.style.display = isP ? "" : "none";
        value.parentElement.style.display = asOf.parentElement.style.display = isP ? "none" : "";
        if (isP) { const a = data.plaid.find((x) => x.id === pSel.value); if (a) { typeSel.value = a.suggestedType; if (!name.value) name.placeholder = `${a.shortName || a.name} …${a.mask}`; } }
        const t = typeOf(typeSel.value);
        note.textContent = !isP && t && data.propertyTypes.includes(t.id) && side === "asset" ? "A building gets its own page on the Properties tab, where you add square footage, rent, expenses, leases and its loan." : "";
      };
      src.addEventListener("change", sync); pSel.addEventListener("change", sync); typeSel.addEventListener("change", sync);
      const save = h("button", { type: "button", class: "btn-small" }, side === "asset" ? "Add asset" : "Add liability");
      save.addEventListener("click", () => {
        const isP = src.value === "plaid";
        run({ op: "add", row: { side, type: typeSel.value, name: name.value || null, plaidAccountId: isP ? pSel.value : null, value: isP ? null : value.value, asOf: asOf.value, rate: rate.value, linkedTo: link.value || null } }, "Added.").then(() => box.replaceChildren());
      });
      box.replaceChildren(h("div", { class: "bs-form" },
        h("div", { class: "ws-row" }, field("From", src), field("Plaid account", pSel), field("Type", typeSel)),
        h("div", { class: "ws-row" }, field("Name", name), field(side === "asset" ? "Value $" : "Balance owed $", value), field("As of", asOf),
          side === "liability" ? field("Rate %", rate, "Optional; Plaid fills it for cards and loans it covers") : null, side === "liability" ? field("Linked to", link) : null),
        note, h("div", { class: "ws-row-btns" }, save, h("button", { type: "button", class: "link-button dark", onclick: () => box.replaceChildren() }, "Cancel"))));
      if (plaidAcct) { src.value = "plaid"; pSel.value = plaidAcct.id; }
      sync();
      box.scrollIntoView({ block: "nearest" });
    }
    return { el: wrap, totals: T };
  }

  // A table of rows with drag-to-reorder, up/down buttons, edit and remove.
  function rowsTable(side, rows, cols, foot, run) {
    const t = h("table", { class: "grid dgrid bs-table" });
    t.append(h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, side === "asset" ? "Asset" : "Liability"), cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)), h("th", {}, ""))));
    const tb = h("tbody");
    const keys = rows.map((r) => r.key);
    const saveOrder = (ks) => run({ op: "reorder", side, keys: ks });
    let dragKey = null;
    rows.forEach((r, i) => {
      const plaidBadge = r.plaidAcct ? h("span", { class: "bs-src", title: `${r.plaidAcct.institution} ${r.plaidAcct.name}` }, `Plaid …${r.plaidAcct.mask}`) : r.src === "Manual" ? h("span", { class: "bs-src manual" }, "Manual") : null;
      const nameCell = h("td", { class: "bs-name" }, h("strong", {}, r.name), r.typeInfo.label ? h("span", { class: "bs-type" }, r.typeInfo.label) : null, plaidBadge,
        r.autoMatched && r.plaidAcct ? h("span", { class: "bs-auto" }, `Matched automatically to ${r.plaidAcct.institution} ${r.plaidAcct.shortName || r.plaidAcct.name} …${r.plaidAcct.mask}.`,
          h("button", { type: "button", class: "link-button dark", onclick: () => run({ op: "confirm", key: r.key }, "Confirmed.") }, "Confirm"),
          h("button", { type: "button", class: "link-button dark", onclick: () => toggleEdit(r, tr) }, "Change")) : null,
        r.missing ? h("span", { class: "bs-auto" }, "No value yet.") : null);
      const mv = h("span", { class: "bs-mv" },
        h("button", { type: "button", title: "Move up", "aria-label": `Move ${r.name} up`, disabled: i === 0 ? true : null, onclick: () => { const k = keys.slice(); [k[i - 1], k[i]] = [k[i], k[i - 1]]; saveOrder(k); } }, "▲"),
        h("button", { type: "button", title: "Move down", "aria-label": `Move ${r.name} down`, disabled: i === rows.length - 1 ? true : null, onclick: () => { const k = keys.slice(); [k[i + 1], k[i]] = [k[i], k[i + 1]]; saveOrder(k); } }, "▼"));
      const tr = h("tr", { draggable: "true", "data-key": r.key },
        h("td", { class: "bs-h", title: "Drag to reorder" }, "⋮⋮", mv),
        nameCell,
        cols.map((c) => { const v = c.get(r); return h("td", { class: [c.num ? "num" : "", c.neg && c.neg(r) ? "neg" : ""].filter(Boolean).join(" ") || null }, v); }),
        h("td", { class: "bs-actions" },
          h("button", { type: "button", class: "link-button dark", onclick: () => toggleEdit(r, tr) }, "Edit"), " ",
          h("button", { type: "button", class: "link-button danger", onclick: () => { if (confirm(`Remove ${r.name} from the balance sheet?${r.key.startsWith("sys:prop:") ? " It also leaves the Properties tab; its history is kept and you can restore it." : " You can restore it later."}`)) run({ op: "remove", key: r.key }, "Removed. Restore it below the balance sheet."); } }, "Remove")));
      tr.addEventListener("dragstart", (e) => { dragKey = r.key; tr.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", r.key); } catch {} });
      tr.addEventListener("dragend", () => { tr.classList.remove("dragging"); tb.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before")); });
      tr.addEventListener("dragover", (e) => { if (!dragKey || dragKey === r.key) return; e.preventDefault(); tb.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before")); tr.classList.add("drop-before"); });
      tr.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!dragKey || dragKey === r.key) return;
        const k = keys.filter((x) => x !== dragKey);
        k.splice(k.indexOf(r.key), 0, dragKey);
        dragKey = null;
        saveOrder(k);
      });
      tb.append(tr);
    });
    if (!rows.length) tb.append(h("tr", {}, h("td", { colspan: String(cols.length + 3) }, h("span", { class: "muted" }, side === "asset" ? "No assets yet." : "No liabilities."))));
    tb.append(h("tr", { class: "sum" }, h("td", {}, ""), h("td", {}, h("strong", {}, foot.label)), foot.cells.map((c, i) => h("td", { class: cols[i] && cols[i].num ? "num" : null }, c)), h("td", {}, "")));
    t.append(tb);

    function toggleEdit(r, tr) {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains("bs-edit")) { next.remove(); return; }
      const isManual = r.key.startsWith("m:");
      const typeSel = typeSelect(side, r.type);
      const name = h("input", { type: "text", value: r.name || "" });
      const value = h("input", { type: "number", step: "0.01", value: r.manual && !r.plaidAcct ? r.value : "" });
      const asOf = h("input", { type: "date", value: (data.balance.rows[r.key] || {}).asOf || today() });
      const rate = h("input", { type: "number", step: "0.01", value: (data.balance.rows[r.key] || {}).rate ?? "" });
      const usedBy = {}; Object.entries(data.balance.rows).forEach(([k, x]) => { if (x.plaidAccountId && !(data.balance.hidden || []).includes(k)) usedBy[x.plaidAccountId] = k; });
      const tagOpts = [["", "Not tagged"]].concat(data.plaid.filter((a) => !usedBy[a.id] || usedBy[a.id] === r.key).map((a) => [a.id, plaidLabel(a)]));
      const tag = h("select", { class: "ws-select" }, tagOpts.map(([v, l]) => { const o = h("option", { value: v }, l); if ((r.plaidAccountId || "") === v) o.selected = true; return o; }));
      const canTag = r.key !== "sys:cash" && !r.key.startsWith("sys:prop:");
      const save = h("button", { type: "button", class: "btn-small" }, "Save");
      save.addEventListener("click", async () => {
        const patch = { type: typeSel.value, name: name.value };
        if (isManual) Object.assign(patch, { value: value.value, asOf: asOf.value, rate: rate.value });
        await run({ op: "update", key: r.key, patch });
        if (canTag && (tag.value || null) !== (r.plaidAccountId || null)) await run({ op: "tag", key: r.key, plaidAccountId: tag.value || null }, "Saved.");
      });
      const hint = r.key === "sys:portfolio" ? "The value comes from the latest positions (Schwab export, or Plaid's holdings once tagged); the Plaid tag also feeds its transactions into performance, income and tax lots."
        : r.key.startsWith("sys:prop:") ? "Value, rent and loans are on the Properties tab." : r.key.startsWith("sys:loan:") ? "Terms are on the Admin tab; a Plaid tag keeps the balance current." : r.key.startsWith("sys:pm:") ? "Terms are on the Properties tab; a Plaid tag keeps the balance current." : "";
      const ed = h("tr", { class: "bs-edit" }, h("td", { colspan: String(cols.length + 3) }, h("div", { class: "bs-form" },
        h("div", { class: "ws-row" }, field("Name", name), field("Type", typeSel), canTag ? field("Plaid account", tag) : null),
        isManual ? h("div", { class: "ws-row" }, r.plaidAcct ? null : field(side === "asset" ? "Value $" : "Balance owed $", value), r.plaidAcct ? null : field("As of", asOf), side === "liability" ? field("Rate %", rate) : null) : null,
        hint ? h("p", { class: "note" }, hint) : null,
        h("div", { class: "ws-row-btns" }, save, h("button", { type: "button", class: "link-button dark", onclick: () => ed.remove() }, "Cancel")))));
      tr.after(ed);
    }
    return h("div", { class: "sheet-scroll", tabindex: "0" }, t);
  }

  window.BSBalance = { load, get data() { return data; }, adjustDebts, compute, render };
})();
