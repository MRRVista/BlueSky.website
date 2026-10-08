// Transactions tab: every Plaid transaction the site has synced, kept after it falls out of Plaid's
// 24-month window. Search, filter, set a category or property (it re-books in the property ledgers),
// add a note, and export to Excel.
(function () {
  const usd = (n, d = 2) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "value") n.value = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v); }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const field = (label, input) => h("label", { class: "tax-field" }, h("span", {}, label), input);
  const select = (options, value) => h("select", { class: "ws-select" }, options.map(([v, l]) => { const o = h("option", { value: v }, l); if (String(v) === String(value ?? "")) o.selected = true; return o; }));
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
    return d;
  };
  const PFC = (s) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");
  let F = { q: "", acct: "", from: "", to: "", kind: "", offset: 0 };

  async function render(slug, root) {
    const s = h("article", { class: "sheet dash ws" }, h("h2", {}, "Transactions"), h("p", { class: "lede" }, "Every transaction synced from Plaid, kept here after it falls out of Plaid's 24-month window. Set a category or a property and it re-books in that property's ledger."));
    root.replaceChildren(s);
    if (window.BSProps) await window.BSProps.load().catch(() => null);
    const PD = window.BSProps && window.BSProps.data;
    const q = h("input", { type: "search", value: F.q, placeholder: "payee, amount, ticker, note" });
    const from = h("input", { type: "date", value: F.from }), to = h("input", { type: "date", value: F.to });
    const kind = select([["", "All"], ["bank", "Bank and card"], ["inv", "Investment"]], F.kind);
    const acctBox = h("span");
    const out = h("div", {}, h("p", { class: "note" }, "Loading…"));
    const go = () => { F = { q: q.value.trim(), acct: (acctBox.querySelector("select") || {}).value || "", from: from.value, to: to.value, kind: kind.value, offset: 0 }; load(); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    [from, to, kind].forEach((el) => el.addEventListener("change", go));
    const exp = h("button", { type: "button", class: "btn-small ghost" }, "Export to Excel");
    exp.addEventListener("click", () => exportAll().catch((e) => alert(e.message)));
    s.append(h("div", { class: "ws-row" }, field("Search", q), h("span", {}, acctBox), field("From", from), field("To", to), field("Kind", kind)), h("div", { class: "ws-row-btns" }, h("button", { type: "button", class: "btn-small", onclick: go }, "Search"), exp), out);
    const cats = PD ? PD.categories.map((c) => c.name) : [];
    const props = PD ? (PD.order || Object.keys(PD.properties)).filter((id) => PD.properties[id].status === "active").map((id) => [id, PD.properties[id].name]) : [];
    const params = () => new URLSearchParams(Object.entries({ q: F.q, acct: F.acct, from: F.from, to: F.to, kind: F.kind, offset: F.offset, limit: 100 }).filter(([, v]) => v !== "" && v != null)).toString();
    async function load() {
      out.replaceChildren(h("p", { class: "note" }, "Loading…"));
      let d;
      try { d = await api(`/api/archive?${params()}`); } catch (e) { out.replaceChildren(h("p", { class: "note" }, e.message)); return; }
      if (!acctBox.firstChild || acctBox.dataset.n !== String(d.accounts.length)) {
        const sel = select([["", "All accounts"]].concat(d.accounts.map((a) => [a.id, a.label])), F.acct);
        sel.addEventListener("change", go);
        acctBox.replaceChildren(field("Account", sel)); acctBox.dataset.n = String(d.accounts.length);
      }
      if (!d.count) { out.replaceChildren(h("p", { class: "note" }, "No transactions yet. Connect accounts on the Inputs tab; the first sync brings in 24 months.")); return; }
      const t = h("table", { class: "grid dgrid" });
      t.append(h("thead", {}, h("tr", {}, ["Date", "Account", "Description", "Amount", "Category", "Property", "Note"].map((x, i) => h("th", { class: i === 3 ? "num" : null }, x)))));
      const tb = h("tbody");
      d.rows.forEach((x) => {
        const money = -x.amount; // + in, − out
        const catSel = x.kind === "bank" ? select([["", PFC(x.pfc) || "—"], ["Transfer", "Transfer (not income or expense)"]].concat(cats.map((c) => [c, c])), (x.u && x.u.category) || "") : null;
        const propSel = x.kind === "bank" ? select([["", "—"]].concat(props), (x.u && x.u.propertyId) || "") : null;
        const note = h("input", { type: "text", value: (x.u && x.u.note) || "", placeholder: "note", style: "width:9rem" });
        const save = (body) => api("/api/archive", { op: "edit", id: x.id, ...body }).then(() => { window.dispatchEvent(new CustomEvent("bs:data-changed", { detail: ["properties"] })); }).catch((e) => alert(e.message));
        if (catSel) catSel.addEventListener("change", () => save({ category: catSel.value || null }));
        if (propSel) propSel.addEventListener("change", () => save({ propertyId: propSel.value || null }));
        note.addEventListener("change", () => save({ note: note.value }));
        const desc = x.kind === "inv" ? `${x.sub || x.type || ""}${x.sym ? ` ${x.sym}` : ""}${x.qty ? ` × ${Math.abs(x.qty)}` : ""} · ${x.name}` : `${x.merchant || x.name}${x.pending ? " (pending)" : ""}`;
        tb.append(h("tr", {}, h("td", {}, fmtDate(x.date)), h("td", { class: "muted small" }, x.account), h("td", {}, desc, x.carried ? h("span", { class: "muted small" }, " · kept from an earlier connection") : null),
          h("td", { class: "num" + (money < 0 ? " neg" : "") }, usd(money)), h("td", {}, catSel || PFC(x.sub)), h("td", {}, propSel || ""), h("td", {}, note)));
      });
      t.append(tb);
      const pager = h("div", { class: "ws-row-btns" },
        h("span", { class: "note inline" }, `${d.total.toLocaleString()} match${d.total === 1 ? "" : "es"} · in ${usd(d.sums.inflow, 0)} · out ${usd(d.sums.outflow, 0)} · ${d.count.toLocaleString()} stored since ${fmtDate(d.oldest)}${d.syncedAt ? ` · last sync ${new Date(d.syncedAt).toLocaleString()}` : ""}`),
        F.offset > 0 ? h("button", { type: "button", class: "link-button dark", onclick: () => { F.offset = Math.max(0, F.offset - 100); load(); } }, "← Newer") : null,
        F.offset + 100 < d.total ? h("button", { type: "button", class: "link-button dark", onclick: () => { F.offset += 100; load(); } }, "Older →") : null);
      out.replaceChildren(pager, h("div", { class: "sheet-scroll" }, t));
    }
    async function exportAll() {
      const d = await api(`/api/archive?${new URLSearchParams(Object.entries({ q: F.q, acct: F.acct, from: F.from, to: F.to, kind: F.kind, export: 1 }).filter(([, v]) => v !== "" && v != null)).toString()}`);
      const X = await new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; sc.onload = () => res(window.XLSX); sc.onerror = () => rej(new Error("The spreadsheet library didn't load.")); document.head.append(sc); });
      const pname = (id) => (PD && PD.properties[id] ? PD.properties[id].name : "");
      const rows = [["Date", "Account", "Description", "Amount (+ in, − out)", "Plaid category", "Category", "Property", "Note", "Ticker", "Quantity", "Pending", "Transaction id"]]
        .concat(d.rows.map((x) => [x.date, x.account, x.merchant || x.name, Math.round(-x.amount * 100) / 100, x.kind === "inv" ? x.sub || x.type : x.pfcd || x.pfc || "", (x.u && x.u.category) || "", pname(x.u && x.u.propertyId), (x.u && x.u.note) || "", x.sym || "", x.qty || "", x.pending ? "yes" : "", x.id]));
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), "Transactions");
      X.writeFile(wb, `transactions_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }
    load();
  }
  window.BSTxns = { tabs: [{ slug: "transactions", name: "Transactions" }], render };
})();
