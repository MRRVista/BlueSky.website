// Blue Sky analytics dashboard: Performance, Gains & Losses, Income, Tax.
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 2) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+m}/${+d}/${y}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split("-"); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }); };
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const neg = (n) => (n < 0 ? "neg" : null);

  function sheet(title, lede) {
    const s = h("article", { class: "sheet dash" }, h("h2", {}, title));
    if (lede) s.append(h("p", { class: "lede" }, lede));
    return s;
  }
  function kpis(items) {
    return h("div", { class: "kpis" }, items.map((k) => h("div", { class: "kpi" + (k.lead ? " kpi--lead" : "") },
      h("div", { class: "kpi-label" }, k.label),
      h("div", { class: "kpi-value " + (k.value && String(k.value).startsWith("−") ? "neg" : "") }, k.value),
      k.sub ? h("div", { class: "kpi-sub" }, k.sub) : null)));
  }
  function section(title, note) {
    return h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  }
  function table(cols, rows, opts = {}) {
    const t = h("table", { class: "grid dgrid" });
    t.append(h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : null }, c.label)))));
    const tb = h("tbody");
    rows.forEach((r) => tb.append(h("tr", { class: r._class || null }, cols.map((c) => {
      const v = c.get(r);
      const raw = c.raw ? c.raw(r) : null;
      return h("td", { class: [c.num ? "num" : "", raw != null && raw < 0 ? "neg" : ""].filter(Boolean).join(" ") || null }, v);
    }))));
    t.append(tb);
    if (opts.foot) t.append(h("tfoot", {}, h("tr", {}, cols.map((c) => { const v = opts.foot[c.key]; return h("td", { class: [c.num ? "num" : "", typeof opts.footRaw?.[c.key] === "number" && opts.footRaw[c.key] < 0 ? "neg" : ""].filter(Boolean).join(" ") || null }, v == null ? "" : v); }))));
    return h("div", { class: "sheet-scroll", tabindex: "0" }, t);
  }

  /* ---------- charts ---------- */
  const C = { gold: "#c9a262", navy: "#183763", sky: "#2f5e96", haze: "#8fb3d9", red: "#b42318", green: "#2e7d4f", grey: "#9aa7bb", bronze: "#a76b2d" };
  function chartBox(height = 300) {
    const canvas = h("canvas");
    return { box: h("div", { class: "chart", style: `height:${height}px` }, canvas), canvas };
  }
  function draw(canvas, config) {
    if (!window.Chart) { canvas.parentElement.replaceChildren(h("p", { class: "note" }, "Chart library didn't load. Refresh to try again.")); return; }
    Chart.defaults.font.family = '"Jost", system-ui, sans-serif';
    Chart.defaults.color = "#4a5b78";
    return new Chart(canvas, config);
  }
  const moneyTick = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`);

  /* ---------- market data (EODHD via /api/market) ---------- */
  async function market(params) {
    const r = await fetch("/api/market?" + new URLSearchParams(params), { credentials: "same-origin" });
    return r.ok ? r.json() : { connected: true, error: "unavailable" };
  }

  /* ================= PERFORMANCE ================= */
  function renderPerformance(root, A) {
    const P = A.performance;
    const s = sheet("Performance", `Account …965, ${fmtDate(P.start)} through ${fmtDate(P.end)}. Returns are measured on net equity, after the margin loan, so they include the effect of leverage.`);
    s.append(kpis([
      { label: "Time-weighted return", value: pct(P.twr), sub: `${pct(P.twrAnnualized)} annualized`, lead: true },
      { label: "Money-weighted return (IRR)", value: pct(P.mwr), sub: "annualized, on your actual dollars" },
      { label: "Total gain", value: usd(P.totalGain), sub: "after margin interest" },
      { label: "Net money added", value: usd(P.netContributions), sub: "deposits less withdrawals" },
      { label: "Account value", value: usd(P.endValue), sub: `net equity on ${fmtDate(P.end)}` },
    ]));
    s.append(h("div", { class: "explain" },
      h("p", {}, h("strong", {}, "Time-weighted "), "measures the strategy itself. It links each month's return and ignores when money went in or out, so it's the number to compare with a benchmark or a manager's target."),
      h("p", {}, h("strong", {}, "Money-weighted "), "measures what your dollars earned. It counts timing: money added before a down month lowers it. When the two differ, timing of deposits and withdrawals is the reason.")));

    s.append(section("Growth of $1", "Your account's time-weighted path at each statement date, against total-return benchmarks."));
    const { box, canvas } = chartBox(320);
    s.append(box);
    const bnote = h("p", { class: "note" }, "Loading benchmarks…");
    s.append(bnote);

    const labels = P.series.map((x) => fmtDate(x.date));
    const datasets = [{ label: "Blue Sky account (TWR)", data: P.series.map((x) => x.growth), borderColor: C.gold, backgroundColor: C.gold, borderWidth: 3, tension: 0.2, pointRadius: 3 }];
    const chart = draw(canvas, {
      type: "line", data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { y: { ticks: { callback: (v) => "$" + Number(v).toFixed(2) } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${Number(c.raw).toFixed(3)} (${pct(c.raw - 1)})` } } } },
    });
    market({ kind: "benchmarks", dates: P.series.map((x) => x.date).join(","), symbols: "SPY,HYG,AGG" }).then((m) => {
      if (!m.connected) { bnote.textContent = "Benchmarks appear here once the EODHD token is added to this site's Vercel project."; return; }
      if (m.error || !m.series) { bnote.textContent = "Benchmarks are unavailable right now."; return; }
      const names = { "SPY.US": ["S&P 500 (SPY)", C.navy], "HYG.US": ["High-yield bonds (HYG)", C.haze], "AGG.US": ["U.S. bonds (AGG)", C.grey] };
      for (const [k, arr] of Object.entries(m.series)) {
        const [label, color] = names[k] || [k, C.grey];
        chart.data.datasets.push({ label, data: arr, borderColor: color, backgroundColor: color, borderWidth: 2, borderDash: [5, 4], tension: 0.2, pointRadius: 0 });
      }
      chart.update();
      const rows = Object.entries(m.series).map(([k, arr]) => `${(names[k] || [k])[0]} ${pct(arr[arr.length - 1] - 1)}`);
      bnote.textContent = `Same window, total return with dividends reinvested: ${rows.join(", ")}. Benchmarks are unlevered.`;
    }).catch(() => { bnote.textContent = "Benchmarks are unavailable right now."; });

    s.append(section("Period by period", "Each row runs between two account values. Gain = ending value − beginning value − net deposits."));
    s.append(table([
      { label: "Period", get: (r) => `${fmtDate(r.start)} – ${fmtDate(r.end)}${r.flowHeavy ? " *" : ""}` },
      { label: "Begin", num: 1, get: (r) => usd(r.begin) },
      { label: "Net deposits", num: 1, get: (r) => usd(r.netFlow), raw: (r) => r.netFlow },
      { label: "Income", num: 1, get: (r) => usd(r.income) },
      { label: "Margin interest", num: 1, get: (r) => usd(r.interest), raw: (r) => r.interest },
      { label: "Realized", num: 1, get: (r) => usd(r.realized), raw: (r) => r.realized },
      { label: "Unrealized", num: 1, get: (r) => usd(r.unrealized), raw: (r) => r.unrealized },
      { label: "Gain", num: 1, get: (r) => usd(r.gain), raw: (r) => r.gain },
      { label: "End", num: 1, get: (r) => usd(r.end_value) },
      { label: "Return", num: 1, get: (r) => pct(r.ret), raw: (r) => r.ret },
    ], P.periods, {
      foot: { label: "Total", netFlow: usd(P.netContributions), income: usd(P.income), interest: usd(P.interest), realized: usd(P.realized), unrealized: usd(P.unrealized), gain: usd(P.totalGain), ret: pct(P.twr) },
      footRaw: { interest: P.interest, realized: P.realized, gain: P.totalGain, unrealized: P.unrealized },
    }));
    // map foot keys
    const foot = s.querySelector("tfoot tr");
    if (foot) { const cells = foot.children; const vals = ["Total", "", usd(P.netContributions), usd(P.income), usd(P.interest), usd(P.realized), usd(P.unrealized), usd(P.totalGain), "", pct(P.twr)]; vals.forEach((v, i) => { cells[i].textContent = v; cells[i].classList.toggle("neg", String(v).startsWith("−")); }); }
    if (P.periods.some((x) => x.flowHeavy)) s.append(h("p", { class: "note" }, "* The account was nearly empty on 1/1 and was funded during this period, so its return is a cash-flow-weighted estimate (Modified Dietz) rather than a statement-to-statement figure. Uploading the January–March month-end values (Upload page → Add a statement value) splits it into exact months."));

    s.append(section("Where the gain came from"));
    const { box: b2, canvas: c2 } = chartBox(220);
    s.append(b2);
    draw(c2, {
      type: "bar",
      data: { labels: ["Income", "Margin interest", "Realized gains/losses", "Unrealized gains/losses", "Total gain"],
        datasets: [{ data: [P.income, P.interest, P.realized, P.unrealized, P.totalGain], backgroundColor: [C.green, C.red, P.realized < 0 ? C.red : C.green, P.unrealized < 0 ? C.red : C.green, C.gold] }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => usd(c.raw) } } }, scales: { x: { ticks: { callback: moneyTick } } } },
    });
    s.append(h("p", { class: "note" }, `Distributions of ${usd(P.income)} carried the year. Price movement was ${usd(P.marketChange)}, of which ${usd(P.realized)} is locked in as realized losses (largely tax-loss harvesting) and ${usd(P.unrealized)} is still unrealized in current holdings.`));
    root.replaceChildren(s);
  }

  /* ================= GAINS & LOSSES ================= */
  function renderGains(root, A) {
    const P = A.performance, pos = A.positions;
    const years = Object.keys(A.realized).sort();
    const R = A.realized[years[years.length - 1]];
    const s = sheet("Gains & losses", "Dollar results: what you made, how much is realized and what's still open in current positions.");
    s.append(kpis([
      { label: "Total gain", value: usd(P.totalGain), sub: `on ~${usd(P.avgCapital)} average capital`, lead: true },
      { label: "Realized (net)", value: usd(R ? R.net : 0), sub: R ? `${usd(R.gains)} gains, ${usd(R.losses)} losses` : "" },
      { label: "Unrealized", value: usd(pos ? sum(pos.holdings, (x) => x.gain) : P.unrealized), sub: pos ? `as of ${fmtDate(pos.asOf)}` : "" },
      { label: "Income received", value: usd(P.income), sub: "distributions and interest" },
      { label: "Margin interest", value: usd(P.interest), sub: "paid on the loan" },
    ]));

    s.append(section("Monthly gain, by source"));
    const { box, canvas } = chartBox(300);
    s.append(box);
    const per = P.periods;
    draw(canvas, {
      type: "bar",
      data: { labels: per.map((x) => fmtDate(x.end)), datasets: [
        { label: "Income", data: per.map((x) => x.income), backgroundColor: C.green, stack: "g" },
        { label: "Margin interest", data: per.map((x) => x.interest), backgroundColor: C.bronze, stack: "g" },
        { label: "Realized", data: per.map((x) => x.realized), backgroundColor: C.red, stack: "g" },
        { label: "Unrealized", data: per.map((x) => x.unrealized), backgroundColor: C.haze, stack: "g" },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}`, footer: (items) => "Net: " + usd(sum(items, (i) => i.raw)) } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } },
    });

    if (pos) {
      const sec = section("Current holdings", `From the ${fmtDate(pos.asOf)} positions export. Gross ${usd(pos.gross)}, margin ${usd(-pos.margin)}, net ${usd(pos.net)}.`);
      const btn = h("button", { class: "btn-small", type: "button" }, "Refresh live prices");
      const status = h("span", { class: "note inline" }, "");
      sec.append(h("div", { class: "toolbar" }, btn, status));
      s.append(sec);
      const holder = h("div");
      s.append(holder);
      const renderHoldings = (quotes) => {
        const rows = pos.holdings.map((x) => {
          const q = quotes && quotes[x.symbol];
          const price = q ? q.price : x.price;
          const mv = q ? price * x.quantity : x.marketValue;
          return { ...x, livePrice: price, liveMV: mv, liveGain: mv - x.costBasis, chg: q ? q.changePct / 100 : null };
        }).sort((a, b) => b.liveMV - a.liveMV);
        holder.replaceChildren(table([
          { label: "Fund", get: (r) => h("span", {}, h("strong", {}, r.symbol), " ", h("span", { class: "muted" }, r.description)) },
          { label: "Shares", num: 1, get: (r) => r.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 }) },
          { label: quotes ? "Price (live)" : "Price", num: 1, get: (r) => usd(r.livePrice, 2) },
          { label: "Today", num: 1, get: (r) => (r.chg == null ? "—" : pct(r.chg)), raw: (r) => r.chg },
          { label: "Market value", num: 1, get: (r) => usd(r.liveMV) },
          { label: "Cost basis", num: 1, get: (r) => usd(r.costBasis) },
          { label: "Unrealized", num: 1, get: (r) => usd(r.liveGain), raw: (r) => r.liveGain },
          { label: "Unrealized %", num: 1, get: (r) => pct(r.liveGain / r.costBasis), raw: (r) => r.liveGain },
          { label: "Yield", num: 1, get: (r) => pct(r.yield) },
          { label: "Est. income / yr", num: 1, get: (r) => usd(r.annualIncome) },
        ], rows, {}));
        const tg = sum(rows, (r) => r.liveGain), mv = sum(rows, (r) => r.liveMV);
        holder.append(h("p", { class: "note" }, `Total market value ${usd(mv)}, unrealized ${usd(tg)}, estimated annual income ${usd(sum(rows, (r) => r.annualIncome))} at current yields.`));
      };
      renderHoldings(null);
      btn.addEventListener("click", async () => {
        btn.disabled = true; status.textContent = "Fetching quotes…";
        const m = await market({ kind: "quotes", symbols: pos.holdings.map((x) => x.symbol).join(",") }).catch(() => ({ error: 1 }));
        btn.disabled = false;
        if (!m.connected) { status.textContent = "Add the EODHD token to the Vercel project to turn on live prices."; return; }
        if (m.error || !m.quotes) { status.textContent = "Quotes are unavailable right now."; return; }
        const map = Object.fromEntries(m.quotes.filter((q) => isFinite(q.price) && q.price > 0).map((q) => [q.symbol, q]));
        renderHoldings(map);
        status.textContent = `Delayed quotes from EODHD, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
      });
    }

    if (R) {
      s.append(section(`Realized gains and losses by fund, ${years[years.length - 1]}`, "Includes funds that have since been sold."));
      s.append(table([
        { label: "Fund", get: (r) => h("span", {}, h("strong", {}, r.symbol), " ", h("span", { class: "muted" }, r.name)) },
        { label: "Lots", num: 1, get: (r) => r.lots },
        { label: "Proceeds", num: 1, get: (r) => usd(r.proceeds) },
        { label: "Cost", num: 1, get: (r) => usd(r.cost) },
        { label: "Gain / loss", num: 1, get: (r) => usd(r.gain), raw: (r) => r.gain },
        { label: "Wash-sale lots", num: 1, get: (r) => r.washLots || "" },
        { label: "Loss deferred", num: 1, get: (r) => (r.disallowed ? usd(r.disallowed) : "") },
      ], R.bySymbol));
    }
    root.replaceChildren(s);
  }

  /* ================= INCOME ================= */
  function renderIncome(root, A) {
    const I = A.income;
    const months = I.byMonth.filter((m) => m.month >= (A.performance.start || "").slice(0, 7));
    const cats = [...new Set(months.flatMap((m) => Object.keys(m).filter((k) => k !== "month" && k !== "total")))];
    const year = (A.performance.end || "").slice(0, 4);
    const ytd = sum(months.filter((m) => m.month.startsWith(year)), (m) => m.total);
    const interestYtd = sum(I.interestByMonth.filter((m) => m.month.startsWith(year)), (m) => m.interest);
    const last3 = months.slice(-4, -1);
    const s = sheet("Income", "Distributions and interest received, by month and by tax character as Schwab reports it today. Final character comes on the 1099.");
    s.append(kpis([
      { label: `${year} income to date`, value: usd(ytd), lead: true },
      { label: "Margin interest paid", value: usd(interestYtd), sub: year },
      { label: "Income after margin interest", value: usd(ytd + interestYtd) },
      { label: "Recent monthly average", value: usd(last3.length ? sum(last3, (m) => m.total) / last3.length : 0), sub: "last 3 full months" },
    ]));
    const palette = [C.green, C.navy, C.gold, C.haze, C.bronze, C.grey, C.sky];
    const { box, canvas } = chartBox(300);
    s.append(section("Income by month"), box);
    draw(canvas, {
      type: "bar",
      data: { labels: months.map((m) => monthLabel(m.month)), datasets: cats.map((k, i) => ({ label: k, data: months.map((m) => m[k] || 0), backgroundColor: palette[i % palette.length], stack: "i" })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } },
    });
    const bySym = I.bySymbol.filter((x) => x.year === year).sort((a, b) => b.amount - a.amount);
    s.append(section(`Income by fund, ${year}`));
    s.append(table([{ label: "Fund", get: (r) => r.symbol }, { label: "Received", num: 1, get: (r) => usd(r.amount, 2) }, { label: "Share", num: 1, get: (r) => pct(r.amount / ytd, 1) }], bySym));
    if (A.positions) {
      const up = A.positions.holdings.filter((x) => x.exDiv || x.payDate).sort((a, b) => (b.exDiv || "").localeCompare(a.exDiv || ""));
      s.append(section("Latest declared distributions", `From the ${fmtDate(A.positions.asOf)} positions export.`));
      s.append(table([
        { label: "Fund", get: (r) => r.symbol },
        { label: "Last distribution / share", num: 1, get: (r) => usd(r.lastDiv, 4) },
        { label: "Ex-date", num: 1, get: (r) => fmtDate(r.exDiv) },
        { label: "Pay date", num: 1, get: (r) => fmtDate(r.payDate) },
        { label: "Est. payment", num: 1, get: (r) => usd(r.lastDiv * r.quantity) },
      ], up));
    }
    root.replaceChildren(s);
  }

  /* ================= TAX ================= */
  function renderTax(root, A) {
    const years = Object.keys(A.realized).sort();
    const year = years[years.length - 1] || (A.performance.end || "").slice(0, 4);
    const R = A.realized[year] || { st: 0, lt: 0, net: 0, gains: 0, losses: 0, washLots: 0, disallowed: 0, detail: [], byMonth: [] };
    const months = A.income.byMonth.filter((m) => m.month.startsWith(year));
    const inc = {};
    months.forEach((m) => Object.entries(m).forEach(([k, v]) => { if (k !== "month" && k !== "total") inc[k] = (inc[k] || 0) + v; }));
    const interestPaid = -sum(A.income.interestByMonth.filter((m) => m.month.startsWith(year)), (m) => m.interest);

    const s = sheet(`Tax picture, ${year}`, `Realized results through ${fmtDate(R.to)} and income received so far. An estimate to review with Jason, not tax advice; final character comes from the ${year} 1099.`);
    s.append(kpis([
      { label: "Net realized", value: usd(R.net), sub: `${usd(R.st)} short-term, ${usd(R.lt)} long-term`, lead: true },
      { label: "Realized gains", value: usd(R.gains) },
      { label: "Realized losses", value: usd(R.losses) },
      { label: "Wash-sale losses deferred", value: usd(R.disallowed), sub: `${R.washLots} lots; added to replacement shares' basis` },
      { label: "Margin interest paid", value: usd(interestPaid), sub: "investment interest expense" },
    ]));

    s.append(section("Estimate", "Adjust the assumptions; everything below recalculates. Defaults are conservative: no return of capital until the 1099 says so."));
    const field = (id, label, value, step, hint) => h("label", { class: "tax-field" }, h("span", {}, label), h("input", { id, type: "number", step, value }), hint ? h("small", {}, hint) : null);
    const form = h("div", { class: "tax-form" },
      field("t-ord", "Federal ordinary rate %", 37, "0.1"),
      field("t-qual", "Federal qualified / LT rate %", 20, "0.1"),
      field("t-state", "State rate %", 4.95, "0.01", "Illinois flat rate; margin interest isn't deductible for Illinois"),
      field("t-roc", "Return of capital share of cash dividends %", 0, "1", "Covered-call funds often report a large share as ROC"),
      field("t-other", "Other net capital gains this year $", 0, "100", "Outside this account; enter gains as positive"),
      h("label", { class: "tax-field tax-check" }, h("input", { id: "t-niit", type: "checkbox", checked: true }), h("span", {}, "Apply 3.8% net investment income tax")),
      h("label", { class: "tax-field tax-check" }, h("input", { id: "t-int", type: "checkbox", checked: true }), h("span", {}, "Deduct margin interest (Form 4952, itemizing)")));
    s.append(form);
    const out = h("div", { class: "tax-out" });
    s.append(out);

    const cashDiv = inc["Cash dividend (character set on 1099)"] || 0;
    const nonQual = inc["Non-qualified dividend"] || 0;
    const qual = inc["Qualified dividend"] || 0;
    const subst = inc["Substitute payment in lieu"] || 0;
    const interest = (inc["Interest"] || 0) + (inc["Cash in lieu"] || 0);
    const calc = () => {
      const q = (id) => form.querySelector("#" + id);
      const g = (id) => Number(q(id).value) || 0;
      const ord = g("t-ord") / 100, ql = g("t-qual") / 100, st = g("t-state") / 100, roc = Math.min(Math.max(g("t-roc"), 0), 100) / 100, other = g("t-other");
      const niit = q("t-niit").checked ? 0.038 : 0;
      const dedInt = q("t-int").checked;
      const rocAmt = cashDiv * roc;
      const ordinaryInc = cashDiv - rocAmt + nonQual + subst + interest;
      const intDeduction = dedInt ? Math.min(interestPaid, ordinaryInc) : 0;
      const netCap = R.st + R.lt + other;
      const capLossDeduction = netCap < 0 ? Math.min(3000, -netCap) : 0;
      const carryforward = netCap < 0 ? -netCap - capLossDeduction : 0;
      const taxableCapGain = netCap > 0 ? netCap : 0;
      const ordinaryTaxable = Math.max(ordinaryInc - intDeduction - capLossDeduction, 0);
      const nii = Math.max(ordinaryInc + qual + taxableCapGain - intDeduction, 0);
      const fed = ordinaryTaxable * ord + (qual + taxableCapGain) * ql;
      // Illinois starts from federal AGI: the $3K capital loss reduces it; itemized margin interest does not.
      const state = Math.max(ordinaryInc + qual + taxableCapGain - capLossDeduction, 0) * st;
      const niitTax = nii * niit;
      const total = fed + state + niitTax;
      const gross = cashDiv + nonQual + qual + subst + interest;
      out.replaceChildren(
        table([{ label: "Line", get: (r) => r.l }, { label: "Amount", num: 1, get: (r) => r.v, raw: (r) => r.raw }], [
          { l: "Cash dividends (character pending 1099)", v: usd(cashDiv) },
          { l: "  less assumed return of capital (reduces basis, not taxed now)", v: usd(-rocAmt), raw: -rocAmt },
          { l: "Non-qualified dividends", v: usd(nonQual) },
          { l: "Substitute payments in lieu of dividends (taxed as ordinary)", v: usd(subst) },
          { l: "Interest", v: usd(interest) },
          { l: "Ordinary investment income", v: usd(ordinaryInc), _class: "sum" },
          { l: "Qualified dividends", v: usd(qual) },
          { l: "Margin interest deducted", v: usd(-intDeduction), raw: -intDeduction },
          { l: `Net capital result (this account ${usd(R.st + R.lt)}${other ? `, other ${usd(other)}` : ""})`, v: usd(netCap), raw: netCap },
          { l: "Capital loss used against ordinary income (annual limit $3,000)", v: usd(-capLossDeduction), raw: -capLossDeduction },
          { l: "Capital loss carried forward to next year", v: usd(carryforward) },
          { l: "Estimated federal income tax", v: usd(fed), _class: "sum" },
          { l: "Estimated state tax", v: usd(state) },
          { l: "Estimated net investment income tax", v: usd(niitTax) },
          { l: "Estimated total tax on this account's income", v: usd(total), _class: "total" },
          { l: "Effective rate on distributions received", v: pct(gross ? total / gross : 0, 1), _class: "sum" },
        ]),
        h("p", { class: "note" }, `For comparison, the workbook assumes an 11% effective rate. The gap is the return-of-capital share: set it above to see the break-even.`));
    };
    form.addEventListener("input", calc);
    calc();

    // Harvesting & wash-sale windows
    if (A.positions) {
      const today = new Date().toISOString().slice(0, 10);
      const rows = A.positions.holdings.slice().sort((a, b) => a.gain - b.gain);
      s.append(section("Harvesting and wash-sale windows", "Selling at a loss within 30 days of buying the same fund defers the loss (wash sale). Reinvestment is off on every position, so only purchases count."));
      s.append(table([
        { label: "Fund", get: (r) => h("strong", {}, r.symbol) },
        { label: "Unrealized", num: 1, get: (r) => usd(r.gain), raw: (r) => r.gain },
        { label: "Last purchase", num: 1, get: (r) => fmtDate(r.lastBuy) },
        { label: "Loss sale is wash-free from", num: 1, get: (r) => (r.gain >= 0 ? "—" : r.washSafeFrom && r.washSafeFrom > today ? fmtDate(r.washSafeFrom) : "Now") },
        { label: "Position held since", num: 1, get: (r) => fmtDate(r.positionStart) },
        { label: "Long-term from", num: 1, get: (r) => fmtDate(r.longTermFrom) },
      ], rows));
      s.append(h("p", { class: "note" }, "Dates come from the transaction history. Buying the fund again within 30 days after a loss sale also triggers a wash sale. 'Held since' is the earliest lot of the current position; later purchases have later long-term dates."));
    }

    // Monthly realized
    if (R.byMonth.length) {
      const { box, canvas } = chartBox(240);
      s.append(section(`Realized by month, ${year}`), box);
      draw(canvas, { type: "bar", data: { labels: R.byMonth.map((m) => monthLabel(m.month)), datasets: [
        { label: "Gains", data: R.byMonth.map((m) => m.gains), backgroundColor: C.green, stack: "r" },
        { label: "Losses", data: R.byMonth.map((m) => m.losses), backgroundColor: C.red, stack: "r" }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } } });
    }

    // For Jason
    s.append(section("For Jason (CPA)"));
    s.append(h("ul", { class: "jason" },
      h("li", {}, `Net short-term capital loss of ${usd(R.st)} through ${fmtDate(R.to)}. It offsets capital gains elsewhere first; only $3,000 a year offsets ordinary income, and the rest carries forward.`),
      h("li", {}, `${R.washLots} lots were wash sales, deferring ${usd(R.disallowed)} of losses into the basis of replacement shares. Not lost, but not deductible this year unless those shares are sold without a repurchase.`),
      subst ? h("li", {}, `${usd(subst)} arrived as substitute payments in lieu of dividends. That happens when margin shares are lent out; these payments are ordinary income and never qualified.`) : null,
      h("li", {}, `${usd(interestPaid)} of margin interest paid this year: confirm Form 4952 treatment against net investment income.`),
      h("li", {}, `${usd(cashDiv)} of cash dividends have no final character yet; the return-of-capital share on the 1099 drives the actual tax.`)));

    // Lot detail
    const det = h("details", { class: "lots" }, h("summary", {}, `All ${R.detail.length} closed lots`));
    det.append(table([
      { label: "Fund", get: (r) => r.s }, { label: "Opened", num: 1, get: (r) => fmtDate(r.o) }, { label: "Closed", num: 1, get: (r) => fmtDate(r.c) },
      { label: "Shares", num: 1, get: (r) => r.q.toLocaleString("en-US", { maximumFractionDigits: 3 }) },
      { label: "Proceeds", num: 1, get: (r) => usd(r.p, 2) }, { label: "Cost", num: 1, get: (r) => usd(r.b, 2) },
      { label: "Gain / loss", num: 1, get: (r) => usd(r.g, 2), raw: (r) => r.g }, { label: "Term", get: (r) => r.t },
      { label: "Wash sale", get: (r) => (r.w ? `Yes, ${usd(r.d, 2)} deferred` : "") },
    ], R.detail));
    s.append(det);
    root.replaceChildren(s);
  }

  window.BSDash = {
    tabs: [
      { slug: "performance", name: "Performance" },
      { slug: "gains", name: "Gains & Losses" },
      { slug: "income", name: "Income" },
      { slug: "tax", name: "Tax" },
    ],
    render(slug, root, A) {
      ({ performance: renderPerformance, gains: renderGains, income: renderIncome, tax: renderTax })[slug](root, A);
    },
  };
})();
