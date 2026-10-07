// Account Split: Legacy (Jen's own funds) vs 5100 Main (refinance proceeds), margin interest traced by use,
// and the share-by-share move of the 5100 Main portion into its own account. Numbers come from /api/split.
(function () {
  if (!document.querySelector('link[href="/split.css"]')) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/split.css" }));
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 1) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const qty = (n) => n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const who = (e) => String(e || "").replace(/@.*/, "").replace(/^mrice$/, "Matt").replace(/^jen$/, "Jen");

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
  const sheet = (title, lede) => h("article", { class: "sheet dash ws split" }, h("h2", {}, title), lede ? h("p", { class: "lede" }, lede) : null);
  const section = (title, note) => h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  const kpis = (items) => h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
    h("div", { class: "kpi-label" }, k.label), h("div", { class: "kpi-value" + (String(k.value).startsWith("−") ? " neg" : "") }, k.value), k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  function table(cols, rows, foot) {
    const t = h("table", { class: "grid dgrid" });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    t.append(h("tbody", {}, rows.map((r) => h("tr", { class: r._class || null }, cols.map((c) => {
      const v = c.get(r); const raw = c.raw ? c.raw(r) : null;
      return h("td", { class: [c.num ? "num" : "", raw != null && raw < 0 ? "neg" : ""].filter(Boolean).join(" ") || null }, v);
    })))));
    if (foot) t.append(h("tfoot", {}, h("tr", {}, cols.map((c) => h("td", { class: c.num ? "num" : null }, foot[c.key] ?? "")))));
    return h("div", { class: "sheet-scroll", tabindex: "0" }, t);
  }
  const toast = (root, msg, kind = "ok") => { const t = h("div", { class: `ws-toast ${kind}`, role: "status" }, msg); root.prepend(t); setTimeout(() => t.remove(), kind === "err" ? 6000 : 2500); };

  async function api(url, body) {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || "Something went wrong. Try again."); e.data = data.data; throw e; }
    return data;
  }

  let D = null, view = null; // last result; as-of date being viewed
  const edits = {};          // flow key -> { sleeve, use, note, reviewed }
  const dirty = () => Object.keys(edits).length;
  const flowVal = (f, k) => (edits[f.key] && k in edits[f.key] ? edits[f.key][k] : f[k]);

  async function render(root) {
    if (!D) root.replaceChildren(sheet("Account Split", "Loading…"));
    try { D = await api("/api/split" + (view ? `?asOf=${view}` : "")); }
    catch (e) { root.replaceChildren(sheet("Account Split", e.message)); return; }
    draw(root);
  }

  async function save(root, extra = {}) {
    const flows = {};
    for (const [k, v] of Object.entries(edits)) { const f = D.flows.find((x) => x.key === k); if (f) flows[k] = { sleeve: flowVal(f, "sleeve"), use: flowVal(f, "use"), note: flowVal(f, "note"), reviewed: flowVal(f, "reviewed") }; void v; }
    try {
      D = await api("/api/split", { version: D.settings.version, flows, view, ...extra });
      for (const k of Object.keys(edits)) delete edits[k];
      draw(root); toast(root.firstChild, "Saved for both of you.");
    } catch (e) {
      if (e.data) { D = e.data; for (const k of Object.keys(edits)) delete edits[k]; draw(root); }
      toast(root.firstChild, e.message, "err");
    }
  }

  function draw(root) {
    const s = sheet("Account Split",
      "The Schwab account holds two sources of money: the 5100 Main refinance wire and Jen's own funds (Legacy: the account before the wire plus every later deposit and withdrawal). This divides the account between them month by month, traces the margin loan by what it paid for, and lays out the move of the 5100 Main share into its own account.");
    if (!D.available) { s.append(h("p", { class: "note" }, D.reason)); root.replaceChildren(s); return; }
    const L = D.sleeves.legacy, M = D.sleeves.main, moveKey = D.settings.newAccount;

    /* ---------- as-of + summary ---------- */
    const asOfSel = h("select", { class: "ws-select", "aria-label": "As of", onchange: (e) => { view = e.target.value; render(root); } },
      D.options.slice().reverse().map((o) => { const opt = h("option", { value: o.date }, `${fmtDate(o.date)} · ${usd(o.value)}`); if (o.date === D.asOf) opt.selected = true; return opt; }));
    const isDefault = D.asOf === D.settings.asOf;
    s.append(h("div", { class: "toolbar" }, h("span", { class: "muted" }, "As of"), asOfSel,
      isDefault ? h("span", { class: "muted small" }, "(default)") : h("button", { class: "link-button dark", type: "button", onclick: () => save(root, { asOf: D.asOf }) }, `Make ${fmtDate(D.asOf)} the default`),
      h("button", { class: "link-button dark", type: "button", onclick: () => copySummary(root) }, "Copy summary")));
    if (D.asOfNote) s.append(h("p", { class: "note warn-text" }, D.asOfNote));
    s.append(kpis([
      { label: `5100 Main on ${fmtDate(D.asOf)}`, value: usd(M.ending), sub: `${pct(M.share)} of the account · ${usd(M.gain)} gain on the ${usd(M.flows)} wire`, lead: true },
      { label: `Legacy (Jen's funds)`, value: usd(L.ending), sub: `${pct(L.share)} · ${usd(L.opening)} at inception, ${usd(L.flows)} net added, ${usd(L.gain)} gain` },
      { label: "Account value (net of margin)", value: usd(D.endValue), sub: `${D.periods.length} month${D.periods.length === 1 ? "" : "s"} linked from ${fmtDate(D.inception.start)}` },
      { label: "Return on each dollar", value: pct(M.ret, 2), sub: `5100 Main; Legacy ${pct(L.ret, 2)} (differs only by the pre-wire margin interest and timing)` },
    ]));
    const unrev = D.flows.filter((f) => f.inWindow && !f.reviewed).length;
    if (unrev) s.append(h("p", { class: "note warn-text" }, `${unrev} deposit${unrev > 1 ? "s and withdrawals have" : " or withdrawal has"} not been reviewed. Confirm each one's source below; the split assumes Legacy for everything except the 3/2 wire.`));

    /* ---------- chart + month by month ---------- */
    s.append(section("How each share got here", "Each month's gain is split by the money each source had at work that month, weighted by the days it was in the account. Margin interest is shared the same way, except interest that accrued before the wire, which is Legacy's alone. Balances carry forward month to month."));
    const canvas = h("canvas");
    s.append(h("div", { class: "chart", style: "height:260px" }, canvas));
    s.append(table([
      { label: "Month ending", get: (r) => fmtDate(r.end) },
      { label: "Account value", num: true, get: (r) => usd(r.value) },
      { label: "Gain", num: true, get: (r) => usd(r.gain), raw: (r) => r.gain },
      { label: "Legacy in/out", num: true, get: (r) => r.legacy.flows ? usd(r.legacy.flows) : "", raw: (r) => r.legacy.flows },
      { label: "Legacy gain", num: true, get: (r) => usd(r.legacy.gain), raw: (r) => r.legacy.gain },
      { label: "Legacy", num: true, get: (r) => usd(r.legacy.end) },
      { label: "5100 Main gain", num: true, get: (r) => usd(r.main.gain), raw: (r) => r.main.gain },
      { label: "5100 Main", num: true, get: (r) => usd(r.main.end) },
      { label: "Legacy share of gain", num: true, get: (r) => pct(r.shareLegacy) },
    ], D.periods, { end: "Total", gain: usd(L.gain + M.gain) }));
    const oneP = D.singlePeriod.shareLegacy;
    s.append(h("p", { class: "note" }, `Cross-check: treated as one period with no month-end values, Legacy's share of the gain would be ${pct(oneP)}; month by month it is ${pct(L.gain / (L.gain + M.gain || 1))}. The monthly figure is the one to use: it reflects how the account actually did while each deposit and withdrawal was in it.`));
    setTimeout(() => chart(canvas), 0);

    /* ---------- ledger ---------- */
    const win = D.flows.filter((f) => f.inWindow);
    s.append(section("Deposits and withdrawals", "Every external flow since inception, from the Schwab transactions. Set the source for each (5100 Main or Legacy) and, for withdrawals, what the money was used for: that decides how margin interest is traced. Mark each one reviewed once its source is documented. Changes apply to both of you."));
    const saveBtn = h("button", { class: "btn-small", type: "button", disabled: !dirty(), onclick: () => save(root) }, dirty() ? `Save ${dirty()} change${dirty() > 1 ? "s" : ""}` : "Saved");
    const markAll = h("button", { class: "link-button dark", type: "button", onclick: () => { win.forEach((f) => { if (!f.reviewed) (edits[f.key] = edits[f.key] || {}).reviewed = true; }); draw(root); } }, "Mark all reviewed");
    s.append(h("div", { class: "toolbar" }, saveBtn, unrev ? markAll : null,
      D.settings.updatedAt ? h("span", { class: "muted small" }, `Last saved by ${who(D.settings.updatedBy)}, ${fmtWhen(D.settings.updatedAt)}`) : null));
    const edit = (f, k, v) => { (edits[f.key] = edits[f.key] || {})[k] = v; saveBtn.disabled = false; saveBtn.textContent = `Save ${dirty()} change${dirty() > 1 ? "s" : ""}`; };
    const opt = (map, cur) => Object.entries(map).map(([v, l]) => { const o = h("option", { value: v }, l); if (v === cur) o.selected = true; return o; });
    const t = h("table", { class: "grid dgrid split-ledger" });
    t.append(h("thead", {}, h("tr", {}, ["Date", "From / to", "Amount", "Source", "Used for", "Note", "Reviewed"].map((c, i) => h("th", { class: i === 2 ? "num" : null }, c)))));
    t.append(h("tbody", {}, win.map((f) => h("tr", { class: flowVal(f, "sleeve") === "main" ? "sum" : null },
      h("td", {}, fmtDate(f.valueDate), f.valueDate !== f.date ? h("div", { class: "muted small" }, `posted ${fmtDate(f.date)}`) : null),
      h("td", {}, f.counterparty, h("div", { class: "muted small" }, f.description)),
      h("td", { class: "num" + (f.amount < 0 ? " neg" : "") }, usd(f.amount, 2)),
      h("td", {}, h("select", { class: "ws-select", "aria-label": "Source", onchange: (e) => edit(f, "sleeve", e.target.value) }, opt(D.labels.sleeves, flowVal(f, "sleeve")))),
      h("td", {}, f.amount < 0 ? h("select", { class: "ws-select", "aria-label": "Used for", onchange: (e) => edit(f, "use", e.target.value) }, opt(D.labels.uses, flowVal(f, "use"))) : h("span", { class: "muted" }, "—")),
      h("td", {}, h("input", { type: "text", class: "split-note", value: flowVal(f, "note"), placeholder: "Source / support", "aria-label": "Note", oninput: (e) => edit(f, "note", e.target.value) })),
      h("td", { style: "text-align:center" }, h("input", { type: "checkbox", checked: flowVal(f, "reviewed"), "aria-label": "Reviewed", onchange: (e) => edit(f, "reviewed", e.target.checked) })),
    ))));
    const inSum = win.filter((f) => f.amount > 0 && flowVal(f, "sleeve") === "legacy").reduce((a, f) => a + f.amount, 0);
    const outSum = win.filter((f) => f.amount < 0 && flowVal(f, "sleeve") === "legacy").reduce((a, f) => a + f.amount, 0);
    s.append(h("div", { class: "sheet-scroll", tabindex: "0" }, t));
    s.append(h("p", { class: "note" }, `Legacy: ${usd(inSum)} in, ${usd(outSum)} out, ${usd(inSum + outSum)} net. Changes to Source take effect in the split after you save.`));

    /* ---------- margin tracing ---------- */
    const G = D.margin;
    s.append(section("Margin interest, traced by use",
      "Interest on borrowed money is deductible according to what the borrowing paid for, not which account it sits in. The cash balance is rebuilt day by day: a withdrawal made while the account was on margin is borrowing for its stated use; a purchase is borrowing for investment. Money coming in (deposits, dividends, sale proceeds) repays the personal-use borrowing first, then investment, then rental, the order the tracing rules set (Treas. Reg. §1.163-8T(d)). Each month's interest is split by the average balance of each use."));
    if (!G.available) s.append(h("p", { class: "note warn-text" }, G.reason));
    else {
      const T = G.totals;
      s.append(kpis([
        { label: "Investment interest", value: usd(-T.investment), sub: "Form 4952: deductible against net investment income", lead: true },
        { label: "Personal-use interest", value: usd(-T.personal), sub: "Not deductible" },
        { label: "Rental-property interest", value: usd(-T.rental), sub: "Schedule E, if any withdrawals paid property costs" },
        { label: "Before the wire", value: usd(-T.preInception), sub: "Accrued on the Legacy account before 3/2/2026" },
      ]));
      const E = G.endDebt, ed = E.personal + E.investment + E.rental;
      s.append(h("p", { class: "note" }, `Margin loan on ${fmtDate(D.asOf)}: ${usd(ed)} — ${usd(E.investment)} investment, ${usd(E.personal)} personal${E.rental ? `, ${usd(E.rental)} rental` : ""}. Since inception, withdrawals were funded with ${usd(G.drawn.personal)} of personal-use borrowing, ${usd(G.repaid.personal)} of it since repaid. ${G.carriedIn.amount ? `${usd(G.carriedIn.amount)} of margin carried in from before the wire is treated as ${G.carriedIn.use}.` : ""}`));
      s.append(table([
        { label: "Charged", get: (r) => fmtDate(r.charged) },
        { label: "Period", get: (r) => `${fmtDate(r.from)} – ${fmtDate(r.to)}` },
        { label: "Interest", num: true, get: (r) => usd(r.interest, 2), raw: (r) => r.interest },
        { label: "Investment", num: true, get: (r) => usd(r.investment, 2), raw: (r) => r.investment },
        { label: "Personal", num: true, get: (r) => usd(r.personal, 2), raw: (r) => r.personal },
        { label: "Rental", num: true, get: (r) => r.rental ? usd(r.rental, 2) : "—", raw: (r) => r.rental },
        { label: "Before wire", num: true, get: (r) => r.preInception ? usd(r.preInception, 2) : "—", raw: (r) => r.preInception },
        { label: "Avg loan", num: true, get: (r) => usd(r.avgDebit) },
        { label: "Implied rate", num: true, get: (r) => pct(r.impliedRate, 2) },
      ], G.bills));
      if (G.adjustments.length) s.append(h("p", { class: "note" }, `Schwab interest adjustments (${G.adjustments.map((a) => `${usd(a.amount, 2)} on ${fmtDate(a.date)}${a.asOf ? ` as of ${fmtDate(a.asOf)}` : ""}`).join("; ")}) follow the split of the month they correct. Totals above include them.`));
      s.append(h("p", { class: "note" }, `Implied rate is the interest divided by the rebuilt average loan; it should sit near Schwab's margin rate each month. A month far off means a transaction is missing from the upload. ${G.anchorNote}`));
    }
    s.append(h("ul", { class: "jason" },
      h("li", {}, "For Jason: confirm the ordering approach and the use assigned to each withdrawal before relying on these figures for Form 4952."),
      h("li", {}, "The 5100 Main mortgage: the refinance proceeds were deposited 3/2/2026 and invested in full on 3/3, within the 15-day window, so the mortgage traces to investments. Keeping the 5100 Main account free of personal withdrawals after the split keeps it that way."),
      h("li", {}, "This is analysis for the owners and their adviser, not tax advice.")));

    /* ---------- the move ---------- */
    const X = D.transfer;
    const moveName = D.labels.sleeves[moveKey];
    const sleeveSel = h("select", { class: "ws-select", "aria-label": "Share moving to the new account", onchange: (e) => save(root, { newAccount: e.target.value }) }, opt(D.labels.sleeves, moveKey));
    s.append(section("Moving the shares", "Splits every position at the same percentage so both accounts keep the same mix and the same leverage. Whole shares move; fractions stay. The margin loan is split at the same percentage, and a small cash journal settles the rounding."));
    s.append(h("div", { class: "toolbar" }, h("span", { class: "muted" }, "Moving to the new account:"), sleeveSel));
    if (!X) s.append(h("p", { class: "note warn-text" }, "Upload a Positions export to see the share-by-share split."));
    else {
      if (!X.matches) s.append(h("p", { class: "note warn-text" }, `Holdings are from the ${fmtDate(X.positionsAsOf)} positions export; the percentage is as of ${fmtDate(D.asOf)}. Pick the same date above, or upload positions for ${fmtDate(D.asOf)}, before journaling.`));
      s.append(table([
        { label: "Symbol", get: (r) => r.symbol },
        { label: "Shares held", num: true, get: (r) => qty(r.quantity) },
        { label: "Price", num: true, get: (r) => usd(r.price, 2) },
        { label: `Shares to move (${pct(X.pct, 2)})`, num: true, get: (r) => qty(r.move) },
        { label: "Shares staying", num: true, get: (r) => qty(r.stay) },
        { label: "Value moving", num: true, get: (r) => usd(r.moveValue) },
      ], X.rows, { symbol: "Total", moveValue: usd(X.moveSecurities) }));
      s.append(kpis([
        { label: "Securities moving", value: usd(X.moveSecurities) },
        { label: "Margin loan moving", value: usd(X.moveDebit), sub: `${pct(X.pct, 2)} of ${usd(X.margin)}` },
        { label: `${moveName} equity`, value: usd(X.target), sub: `${pct(X.pct, 2)} of ${usd(X.net)} net` },
        { label: X.cashTrueUp >= 0 ? "Cash to the new account" : "Cash back to the old account", value: usd(Math.abs(X.cashTrueUp)), sub: "Settles whole-share rounding" },
      ]));
      s.append(h("ol", { class: "jason" },
        h("li", {}, `Open a margin-enabled Schwab account for the ${moveName} share, titled the same as the current account.`),
        h("li", {}, "Journal the whole shares in the table, in kind (no sales, so no gains are realized and cost basis carries over)."),
        h("li", {}, `Have the new account borrow ${usd(X.moveDebit)} on margin and journal it to the current account. That moves its share of the loan; both accounts end at the same leverage. Confirm with Schwab that each meets the house margin requirement.`),
        h("li", {}, `Journal ${usd(Math.abs(X.cashTrueUp))} of cash ${X.cashTrueUp >= 0 ? "to the new account" : "back to the current account"} for the rounding.`),
        h("li", {}, `Re-run this as of the day before the journal. From then on, Jen's deposits and withdrawals go through the Legacy account only.`)));
    }

    /* ---------- checks ---------- */
    s.append(section("Checks", `Inception value ${usd(D.inception.value)} (${D.inception.source}). Funding wire ${D.fundingWire ? `${usd(D.fundingWire.amount)} on ${fmtDate(D.fundingWire.date)}` : "not found"}.`));
    s.append(h("ul", { class: "split-checks" }, D.checks.map((c) => h("li", { class: c.ok ? "ok" : "warn" }, c.ok ? "✓ " : "! ", c.label, c.detail && !c.ok ? h("span", { class: "muted" }, ` — ${c.detail}`) : null))));
    root.replaceChildren(s);
  }

  function chart(canvas) {
    if (!window.Chart || !canvas.isConnected) return;
    const P = D.periods;
    new Chart(canvas, {
      type: "bar",
      data: { labels: [fmtDate(D.inception.start)].concat(P.map((p) => fmtDate(p.end))), datasets: [
        { label: "5100 Main", data: [0].concat(P.map((p) => p.main.end)), backgroundColor: "#183763", stack: "s" },
        { label: "Legacy", data: [D.inception.value].concat(P.map((p) => p.legacy.end)), backgroundColor: "#c9a262", stack: "s" },
      ] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`) } } } },
    });
  }

  async function copySummary(root) {
    const L = D.sleeves.legacy, M = D.sleeves.main, G = D.margin;
    const lines = [
      `Account split as of ${fmtDate(D.asOf)} (account value ${usd(D.endValue)} net of margin)`,
      `5100 Main refinance proceeds: ${usd(M.ending)} (${pct(M.share, 2)}) = ${usd(M.flows)} wire on ${D.fundingWire ? fmtDate(D.fundingWire.date) : "—"} + ${usd(M.gain)} gain`,
      `Legacy (Jen's own funds): ${usd(L.ending)} (${pct(L.share, 2)}) = ${usd(L.opening)} at ${fmtDate(D.inception.start)} + ${usd(L.flows)} net deposits + ${usd(L.gain)} gain`,
      `Method: monthly Modified Dietz, ${D.periods.length} months linked; pre-wire margin interest charged to Legacy.`,
    ];
    if (G.available) lines.push(`Margin interest since inception: ${usd(-G.totals.investment)} investment, ${usd(-G.totals.personal)} personal, ${usd(-G.totals.rental)} rental, ${usd(-G.totals.preInception)} before the wire (traced by use; repayments applied personal-first per 1.163-8T(d)).`);
    const text = lines.join("\n");
    try { await navigator.clipboard.writeText(text); } catch { const ta = h("textarea", {}, text); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    toast(root.firstChild, "Summary copied.");
  }

  window.BSSplit = { tabs: [{ slug: "split", name: "Account Split" }], render: (slug, root) => { render(root); } };
})();
