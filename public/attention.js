// "Needs attention" box on the Overview: missed rent, transactions to review, possible tenants, lease
// dates, tax lot mismatches, loan maturities and Plaid connections that need a person.
(function () {
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v); }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.na-box { margin: 0 0 1.25rem; border: 1px solid #e3e9f2; border-radius: 8px; background: #fff; }
.na-box h3 { margin: 0; padding: 0.65rem 1rem; font-size: 1rem; font-weight: 500; border-bottom: 1px solid #eef1f6; display: flex; justify-content: space-between; }
.na-box ul { list-style: none; margin: 0; padding: 0.35rem 0; }
.na-box li { display: flex; gap: 0.6rem; align-items: baseline; padding: 0.3rem 1rem; font-size: 0.9rem; }
.na-box li button { font: inherit; text-align: left; background: none; border: 0; padding: 0; color: #183763; cursor: pointer; }
.na-box li button:hover { text-decoration: underline; }
.na-dot { flex: none; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: #8fb3d9; transform: translateY(-0.05rem); }
.na-dot.bad { background: #b42318; } .na-dot.warn { background: #d99a1e; }
.na-more { padding: 0 1rem 0.6rem; }
.na-ok { padding: 0.6rem 1rem; color: #2e6b45; font-size: 0.9rem; }
` }));

  function items(M, ctx) {
    const out = [];
    const d = today();
    // properties
    if (window.BSPropX && ctx.props) out.push(...window.BSPropX.alerts(ctx.props));
    // Plaid connections
    const B = ctx.balance;
    if (B) {
      B.items.filter((i) => i.needsLogin).forEach((i) => out.push({ level: "bad", text: `${i.institution}: the bank sign-in expired. Reconnect it on the Inputs tab.`, go: () => { location.hash = "#inputs"; } }));
      const up = B.items.filter((i) => !i.needsLogin && i.needsUpgrade).map((i) => i.institution);
      if (up.length) out.push({ level: "warn", text: `Reconnect ${up.join(", ")} once with the new Connect button for 24 months of history, holdings and loan details.`, go: () => { location.hash = "#inputs"; } });
      B.items.filter((i) => i.error && !i.needsLogin).forEach((i) => out.push({ level: "warn", text: `${i.institution}: ${i.error}`, go: () => { location.hash = "#inputs"; } }));
      const auto = Object.entries(B.balance.rows || {}).filter(([k, r]) => r.autoMatched && r.plaidAccountId && !(B.balance.hidden || []).includes(k)).length;
      if (auto) out.push({ level: "info", text: `${auto} balance sheet row${auto === 1 ? " was" : "s were"} matched to Plaid automatically. Confirm or change each below.`, go: scrollToSheet });
      const ready = B.plaid.filter((a) => !a.row && !a.dismissed).length;
      if (ready) out.push({ level: "info", text: `${ready} Plaid account${ready === 1 ? " isn't" : "s aren't"} on the balance sheet yet. Add or dismiss ${ready === 1 ? "it" : "them"} below.`, go: scrollToSheet });
    }
    // tax lots
    const L = ctx.analytics && ctx.analytics.lots;
    if (L && L.checks && L.checks.length) out.push({ level: "warn", text: `Tax lots: ${L.checks.length} item${L.checks.length === 1 ? "" : "s"} disagree with Schwab's holdings (${[...new Set(L.checks.map((c) => c.symbol))].join(", ")}).`, go: () => { location.hash = "#taxplan"; } });
    if (L && L.afterFile) { const w = L.afterFile.filter((c) => c.wash).length; if (w) out.push({ level: "warn", text: `Possible wash sale${w === 1 ? "" : "s"} on ${w} recent sale${w === 1 ? "" : "s"} (a buy of the same fund within 30 days).`, go: () => { location.hash = "#taxplan"; } }); }
    // loans
    for (const db of M.debts || []) if (db.maturity && db.maturity >= d && db.maturity <= addDays(d, 365)) out.push({ level: "warn", date: db.maturity, text: `${db.name} matures ${fmtDate(db.maturity)}${db.balloon ? ` (balloon about $${Math.round(db.balloon).toLocaleString()})` : ""}.` });
    return out;
  }
  function scrollToSheet() { const el = [...document.querySelectorAll(".dash-sec h3")].find((x) => x.textContent === "Balance sheet"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }

  function box(M, ctx) {
    const all = items(M, ctx);
    const rank = { bad: 0, warn: 1, info: 2 };
    all.sort((a, b) => rank[a.level] - rank[b.level] || (a.date || "9") .localeCompare(b.date || "9"));
    const wrap = h("div", { class: "na-box" }, h("h3", {}, "Needs attention", h("span", { class: "muted small" }, all.length ? `${all.length}` : "")));
    if (!all.length) { wrap.append(h("div", { class: "na-ok" }, "Nothing needs attention.")); return wrap; }
    const ul = h("ul");
    const show = (n) => ul.replaceChildren(...all.slice(0, n).map((a) => h("li", {}, h("span", { class: `na-dot ${a.level}` }), a.go ? h("button", { type: "button", onclick: a.go }, a.text) : h("span", {}, a.text))));
    show(8);
    wrap.append(ul);
    if (all.length > 8) { const more = h("button", { type: "button", class: "link-button dark" }, `Show all ${all.length}`); more.addEventListener("click", () => { show(all.length); more.remove(); }); wrap.append(h("div", { class: "na-more" }, more)); }
    return wrap;
  }
  window.BSAttention = { box, items };
})();
