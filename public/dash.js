// Blue Sky analytics dashboard: Performance, Gains & Losses, Income, Tax.
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 2) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n * 100).toFixed(d) + "%";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+m}/${+d}/${y}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split("-"); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }); };
  const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
  const isoToUs = (t) => String(t || "").replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => `${+m}/${+d}/${y}`);

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


  const addDaysIso = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

  /* ---------- reporting windows ---------- */
  let winKey = (() => { try { return sessionStorage.getItem("bs-win") || "YTD"; } catch { return "YTD"; } })();
  let gLayer = (() => { try { return sessionStorage.getItem("bs-layer") || "portfolio"; } catch { return "portfolio"; } })();
  let propsRequested = false;
  const LAYERS = [["portfolio", "Portfolio only"], ["rents", "+ Rents"], ["full", "+ Rents, costs & mortgage"]];
  // Property cash flows between two dates for the selected layer (null when only the portfolio is shown).
  function propLayer(lo, hi) {
    const B = window.BSProps;
    if (gLayer === "portfolio" || !B || !B.data) return null;
    const p = B.data.properties[B.current];
    if (!p || p.status !== "active") return null;
    const x = B.between(B.current, lo, hi);
    if (gLayer === "rents") return { name: p.name, rent: x.rent, costs: 0, interest: 0, principal: 0, payment: 0, balloon: 0, economic: x.rent, netCash: x.rent, entries: x.entries };
    return { name: p.name, ...x };
  }
  function layerBar(rerender) {
    const B = window.BSProps;
    const wrap = h("div", { class: "periodpick layerbar" });
    const pick = (k) => { gLayer = k; try { sessionStorage.setItem("bs-layer", k); } catch {} rerender(); };
    wrap.append(h("div", { class: "periodbar", role: "group", "aria-label": "What to include" }, h("span", { class: "pb-label" }, "Include"),
      LAYERS.map(([k, label]) => { const on = gLayer === k; const b = h("button", { type: "button", class: "pb" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false" }, label); b.addEventListener("click", () => pick(k)); return b; })));
    if (gLayer !== "portfolio") {
      if (!B || !B.data) wrap.append(h("p", { class: "note" }, B ? "Loading property data…" : "Property data isn't available."));
      else {
        const D = B.data;
        if (!D.properties[B.current] || D.properties[B.current].status !== "active") B.current = (D.order || Object.keys(D.properties)).find((id) => D.properties[id].status === "active") || B.current;
        wrap.append(h("div", { class: "periodbar", role: "group", "aria-label": "Property" }, h("span", { class: "pb-label" }, "Property"),
          (D.order || Object.keys(D.properties)).map((id) => {
            const p = D.properties[id], soon = p.status !== "active", on = !soon && id === B.current;
            const b = h("button", { type: "button", class: "pb" + (on ? " on" : "") + (soon ? " soon" : ""), "aria-pressed": on ? "true" : "false", disabled: soon, title: soon ? `${p.name}: coming soon` : p.name },
              p.name, soon ? h("span", { class: "soon-tag" }, "Coming soon") : null);
            b.addEventListener("click", () => { B.current = id; rerender(); });
            return b;
          })));
      }
    }
    return wrap;
  }
  let custom = (() => { try { return JSON.parse(sessionStorage.getItem("bs-custom") || "null"); } catch { return null; } })();
  const windowsOf = (A) => A.performance.windows || [];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const prevMonthEnd = (ym) => addDaysIso(ym + "-01", -1);
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  // Account value at every valuation point (index matches performance.series).
  function valuePoints(A) {
    const P = A.performance;
    return P.series.map((x, k) => ({ date: x.date, value: k === 0 ? (P.periods[0] ? P.periods[0].begin : P.beginValue) : P.periods[k - 1].end_value }));
  }
  function nearestIdx(pts, d, tol) {
    let best = -1, bd = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(dayDiff(p.date, d)); if (dd < bd) { bd = dd; best = i; } });
    return bd <= tol ? best : -1;
  }
  function xirr(cf) {
    if (cf.length < 2) return null;
    const t0 = Date.parse(cf[0].date), yrs = cf.map((c) => (Date.parse(c.date) - t0) / (365 * 864e5));
    const npv = (r) => cf.reduce((a, c, i) => a + c.amount / Math.pow(1 + r, yrs[i]), 0);
    let lo = -0.9999, hi = 10, flo = npv(lo);
    if (flo * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = npv(mid); if (Math.abs(fm) < 1e-6) return mid; if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; } }
    return (lo + hi) / 2;
  }

  // A window between two dates. Performance needs account values at both ends (month-end statements);
  // cash views (income) use the exact dates. `snap` (custom ranges) moves to the nearest statement dates.
  function rangeWindow(A, def) {
    const P = A.performance, pts = valuePoints(A), I = A.inception || {};
    const anchor = pts[0].date, last = pts[pts.length - 1].date;
    const w = { key: def.key, label: def.label, chip: def.chip, group: def.group, start: def.start, end: def.end };
    w.cashStart = def.start < anchor ? anchor : def.start;
    w.cashEnd = def.end;
    w.cashAvailable = def.end > anchor && w.cashStart < def.end && !!A.income.firstDate;
    if (!w.cashAvailable) w.cashReason = `Before inception (${fmtDate(I.date)}).`;
    else if (def.start < anchor) w.cashNote = `Starts at inception, ${fmtDate(I.date)}.`;
    let a, b;
    if (def.snap) {
      a = nearestIdx(pts, def.start < anchor ? anchor : def.start, 1e6);
      b = nearestIdx(pts, def.end > last ? last : def.end, 1e6);
    } else {
      if (def.start < addDaysIso(anchor, -3)) { w.available = false; w.reason = `Before inception (${fmtDate(I.date)}).`; return w; }
      a = nearestIdx(pts, def.start, 3);
      b = def.end >= last ? pts.length - 1 : nearestIdx(pts, def.end, 3);
      if (a < 0) { w.available = false; w.reason = `Needs the ${fmtDate(def.start)} statement value. Add it on the Upload page.`; return w; }
      if (b < 0) { w.available = false; w.reason = `Needs the ${fmtDate(def.end)} statement value. Add it on the Upload page.`; return w; }
    }
    if (b <= a) { w.available = false; w.reason = "Pick a range that spans at least one statement period."; return w; }
    const ps = P.periods.slice(a, b);
    const net = sum(ps, (x) => x.netFlow), D = dayDiff(pts[a].date, pts[b].date);
    const twr = ps.reduce((g, x) => g * (1 + (x.ret || 0)), 1) - 1;
    const fl = (P.flows || []).filter((f) => f.d > pts[a].date && f.d <= pts[b].date);
    const irr = xirr([{ date: pts[a].date, amount: -pts[a].value }].concat(fl.map((f) => ({ date: f.d, amount: -f.a }))).concat([{ date: pts[b].date, amount: pts[b].value }]));
    Object.assign(w, {
      available: true, start: pts[a].date, end: pts[b].date, startIndex: a, endIndex: b, days: D,
      begin: pts[a].value, endValue: pts[b].value, netFlow: net, gain: pts[b].value - pts[a].value - net,
      income: sum(ps, (x) => x.income), interest: sum(ps, (x) => x.interest), realized: sum(ps, (x) => x.realized), unrealized: sum(ps, (x) => x.unrealized),
      twr, twrAnnualized: D >= 365 ? Math.pow(1 + twr, 365 / D) - 1 : null,
      mwrAnnualized: irr, mwr: irr == null ? null : D >= 365 ? irr : Math.pow(1 + irr, D / 365) - 1,
      estimated: ps.some((x) => x.flowHeavy) || (a === 0 && !!I.estimated),
    });
    if (def.snap && (pts[a].date !== def.start || pts[b].date !== def.end)) w.snapNote = `Returns run ${fmtDate(addDaysIso(pts[a].date, 1))} – ${fmtDate(pts[b].date)}, the nearest statement dates to ${fmtDate(custom.from)} – ${fmtDate(custom.to)}. The Income tab uses your exact dates.`;
    return w;
  }

  // Standard windows + past calendar years + each of the last 12 months + custom range.
  function allWindows(A) {
    const out = windowsOf(A).slice();
    const last = A.performance.end;
    if (!last) return out;
    const curY = +last.slice(0, 4);
    const firstY = +((A.income.firstDate || last).slice(0, 4));
    for (let y = firstY; y < curY; y++) out.push(rangeWindow(A, { key: `Y${y}`, label: String(y), chip: String(y), group: "year", start: `${y - 1}-12-31`, end: `${y}-12-31` }));
    const [ly, lm] = last.slice(0, 7).split("-").map(Number);
    for (let k = 11; k >= 0; k--) {
      const d = new Date(Date.UTC(ly, lm - 1 - k, 1));
      const ym = d.toISOString().slice(0, 7), mi = d.getUTCMonth(), yy = d.getUTCFullYear();
      const isCur = k === 0;
      out.push(rangeWindow(A, { key: `M${ym}`, label: `${MON[mi]} ${yy}${isCur ? " to date" : ""}`, chip: `${MON[mi]} '${String(yy).slice(2)}`, group: "month",
        start: prevMonthEnd(ym), end: isCur ? last : monthEnd(ym) }));
    }
    if (custom && custom.from && custom.to) out.push(rangeWindow(A, { key: "CUSTOM", label: "Custom range", chip: "Custom", group: "custom", start: addDaysIso(custom.from, -1), end: custom.to, snap: true }));
    return out;
  }
  function pickWindow(A, mode) {
    const ws = allWindows(A);
    const ok = (w) => (mode === "cash" ? w.cashAvailable : w.available);
    return ws.find((w) => w.key === winKey && ok(w)) || ws.find((w) => w.key === "YTD" && ok(w)) || ws.find(ok);
  }
  function periodBar(A, mode, rerender) {
    const current = pickWindow(A, mode);
    const all = allWindows(A);
    const ok = (w) => (mode === "cash" ? w.cashAvailable : w.available);
    const reasonOf = (w) => isoToUs(mode === "cash" ? (w.cashReason || `Transaction history starts ${A.income.firstDate}.`) : w.reason);
    const choose = (key) => { winKey = key; try { sessionStorage.setItem("bs-win", key); } catch {} rerender(); };
    const chip = (w) => {
      const on = current && w.key === current.key;
      const b = h("button", { type: "button", class: "pb" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", disabled: !ok(w), title: ok(w) ? w.label : reasonOf(w) }, w.chip || w.label);
      b.addEventListener("click", () => choose(w.key));
      return b;
    };
    const row = (label, ws) => h("div", { class: "periodbar", role: "group", "aria-label": label || "Reporting period" }, label ? h("span", { class: "pb-label" }, label) : null, ws.map(chip));
    const wrap = h("div", { class: "periodpick" });
    wrap.append(row(null, all.filter((w) => !w.group)));
    const years = all.filter((w) => w.group === "year");
    if (years.length) wrap.append(row("Calendar year", years));
    wrap.append(row("Month", all.filter((w) => w.group === "month")));

    // custom range
    const I = A.inception || {};
    const minD = I.date || A.performance.start, maxD = A.performance.end;
    const f = h("input", { type: "date", value: (custom && custom.from) || minD, min: minD, max: maxD, "aria-label": "Custom range start" });
    const t = h("input", { type: "date", value: (custom && custom.to) || maxD, min: minD, max: maxD, "aria-label": "Custom range end" });
    const go = h("button", { type: "button", class: "pb" + (current && current.key === "CUSTOM" ? " on" : "") }, "Apply");
    const cmsg = h("span", { class: "pb-range", role: "status" });
    go.addEventListener("click", () => {
      if (!f.value || !t.value) { cmsg.textContent = "Pick both dates."; return; }
      if (f.value > t.value) { cmsg.textContent = "The start date is after the end date."; return; }
      custom = { from: f.value, to: t.value };
      try { sessionStorage.setItem("bs-custom", JSON.stringify(custom)); } catch {}
      choose("CUSTOM");
    });
    wrap.append(h("div", { class: "periodbar", role: "group", "aria-label": "Custom range" }, h("span", { class: "pb-label" }, "Custom"),
      h("label", { class: "pb-date" }, h("span", {}, "From"), f), h("label", { class: "pb-date" }, h("span", {}, "To"), t), go, cmsg));

    if (current) {
      const from = mode === "cash" ? current.cashStart : current.start, to = mode === "cash" ? (current.cashEnd || current.end) : current.end;
      const line = h("p", { class: "pb-showing" }, h("strong", {}, current.label), ` · ${fmtDate(addDaysIso(from, 1))} – ${fmtDate(to)}`);
      const wanted = all.find((w) => w.key === winKey);
      if (wanted && wanted.key !== current.key) line.append(h("span", { class: "muted" }, ` · ${wanted.label} isn't available on this tab (${reasonOf(wanted)}), so ${current.label} is shown.`));
      const note = mode === "cash" ? current.cashNote : current.snapNote;
      if (note) line.append(h("span", { class: "muted" }, " · " + note));
      wrap.append(line);
    }
    return wrap;
  }
  // Performance and gain figures for one window.
  function perfView(A, w) {
    const P = A.performance, si = w.startIndex, ei = w.endIndex ?? P.series.length - 1;
    const base = P.series[si].growth;
    return { ...P, start: w.start, end: w.end, days: w.days, beginValue: w.begin, endValue: w.endValue, netContributions: w.netFlow,
      totalGain: w.gain, twr: w.twr, twrAnnualized: w.twrAnnualized, mwr: w.mwr, mwrAnnualized: w.mwrAnnualized,
      income: w.income, interest: w.interest, realized: w.realized, unrealized: w.unrealized, marketChange: w.gain - w.income - w.interest,
      periods: P.periods.slice(si, ei), series: P.series.slice(si, ei + 1).map((x) => ({ date: x.date, growth: x.growth / base })), estimated: w.estimated, label: w.label };
  }
  // Realized lots closed inside the window, grouped like the server's yearly summary.
  function realizedView(A, start, end) {
    const names = {};
    Object.values(A.realized).forEach((r) => r.bySymbol.forEach((b) => { names[b.symbol] = b.name; }));
    const lots = Object.values(A.realized).flatMap((r) => r.detail).filter((l) => l.c > start && l.c <= end);
    const by = {};
    lots.forEach((l) => {
      const b = (by[l.s] = by[l.s] || { symbol: l.s, name: names[l.s] || "", lots: 0, proceeds: 0, cost: 0, gain: 0, washLots: 0, disallowed: 0 });
      b.lots++; b.proceeds += l.p; b.cost += l.b; b.gain += l.g; if (l.w) { b.washLots++; b.disallowed += l.d; }
    });
    return { net: sum(lots, (l) => l.g), gains: sum(lots.filter((l) => l.g > 0), (l) => l.g), losses: sum(lots.filter((l) => l.g < 0), (l) => l.g),
      st: sum(lots.filter((l) => l.t === "ST"), (l) => l.g), lt: sum(lots.filter((l) => l.t === "LT"), (l) => l.g), count: lots.length,
      bySymbol: Object.values(by).sort((a, b) => a.gain - b.gain) };
  }
  function unavailable(root, title, A, mode, rerender) {
    const s = sheet(title);
    s.append(periodBar(A, mode, rerender), h("p", { class: "note" }, "No period has enough data yet. Upload files or add statement values on the Upload page."));
    root.replaceChildren(s);
  }

  // Performance starts at inception (3/1/2026, the day before the 3/2 refinance wire).
  function inceptionNote(A) {
    const I = A.inception;
    if (!I || !I.start) return null;
    const p = h("p", { class: "note" }, `Inception ${fmtDate(I.date)}: returns start from the ${fmtDate(I.start)} account value of ${usd(I.value)}. `);
    if (I.estimated) {
      const b = I.basis || {};
      p.append(`That value is an estimate (${fmtDate(b.from)} value ${usd(b.priorValue)} + net deposits ${usd(b.flows)} + income ${usd(b.income)} + margin interest ${usd(b.interest)}); January–February market movement isn't in it. Enter the ${fmtDate(I.start)} statement ending value on the Upload page to make it exact.`);
    }
    return p;
  }

  /* ---------- benchmark proxy (blend of index ETFs, total return) ---------- */
  let bmDraft = null; // unsaved edits in this browser session
  const bmCache = {};
  const bmCfg = (A) => bmDraft || A.benchmark.saved || A.benchmark.defaults;
  const bmLabel = (A, cfg) => {
    const name = (c) => (A.benchmark.catalog.find((x) => x.symbol === c.symbol) || {}).name || (c.name && c.name !== c.symbol ? `${c.symbol} (${c.name})` : c.symbol);
    const mix = cfg.components.map((c) => `${+c.weight}% ${name(c)}`).join(" / ");
    return cfg.leverage && cfg.leverage !== 1 ? `${mix}, ${cfg.leverage}× levered` : mix;
  };
  function bmFetch(A, symbols) {
    const dates = A.performance.series.map((x) => x.date).join(",");
    const key = symbols.slice().sort().join(",") + "|" + dates;
    if (!bmCache[key]) bmCache[key] = market({ kind: "benchmarks", dates, symbols: symbols.join(",") }).catch(() => ({ connected: true, error: 1 }));
    return bmCache[key];
  }
  // Growth of $1 for the blend at each statement date across the whole inception series.
  // Rebalanced to target weights at each statement date; leverage adds L× the blend return less (L−1)× borrowing cost.
  function blendGrowth(A, cfg, m) {
    const dates = A.performance.series.map((x) => x.date);
    const L = Number(cfg.leverage) || 1, rate = (Number(cfg.borrowRate) || 0) / 100;
    const g = [1];
    for (let k = 1; k < dates.length; k++) {
      if (g[k - 1] == null) { g.push(null); continue; }
      let r = 0, ok = true;
      for (const c of cfg.components) {
        const ser = m.series[`${c.symbol}.US`];
        if (!ser || ser[k] == null || ser[k - 1] == null) { ok = false; break; }
        r += (c.weight / 100) * (ser[k] / ser[k - 1] - 1);
      }
      if (!ok) { g.push(null); continue; }
      const dt = (Date.parse(dates[k]) - Date.parse(dates[k - 1])) / (365 * 864e5);
      r = L * r - (L - 1) * rate * dt;
      g.push(g[k - 1] * (1 + r));
    }
    return g;
  }

  /* ---------- public market equivalent (PME) ---------- */
  // A shadow account that starts with the account's value at the window start, receives the same dated
  // deposits and withdrawals, and holds the benchmark blend. Income is split out using dividend-adjusted
  // vs unadjusted prices for each ETF; leverage and borrowing cost follow the benchmark settings.
  const pmeCache = {};
  function pmeGrid(A, w) {
    const set = new Set([w.start, w.end]);
    valuePoints(A).forEach((p) => { if (p.date > w.start && p.date < w.end) set.add(p.date); });
    (A.performance.flows || []).forEach((f) => { if (f.d > w.start && f.d <= w.end) set.add(f.d); });
    for (let m = addDaysIso(w.start, 1).slice(0, 7); monthEnd(m) < w.end; m = addDaysIso(monthEnd(m), 1).slice(0, 7)) if (monthEnd(m) > w.start) set.add(monthEnd(m));
    return [...set].sort();
  }
  function pmeCompute(A, w, cfg, m, grid) {
    const L = Number(cfg.leverage) || 1, rate = (Number(cfg.borrowRate) || 0) / 100;
    const flows = A.performance.flows || [];
    let V = w.begin;
    const steps = [], missing = new Set();
    for (let k = 1; k < grid.length; k++) {
      let tr = 0, inc = 0;
      for (const c of cfg.components) {
        const key = `${c.symbol}.US`, T = m.series[key], Pp = m.price && m.price[key];
        if (!T || T[k] == null || T[k - 1] == null) { missing.add(c.symbol); continue; }
        const ti = T[k] / T[k - 1] - 1;
        let pi = Pp && Pp[k] != null && Pp[k - 1] != null ? Pp[k] / Pp[k - 1] - 1 : ti;
        if (Math.abs(ti - pi) > 0.15) pi = ti; // a split, not a distribution
        tr += (c.weight / 100) * ti;
        inc += (c.weight / 100) * Math.max(ti - pi, 0);
      }
      const dt = dayDiff(grid[k - 1], grid[k]) / 365;
      const borrow = V * (L - 1) * rate * dt;
      const gain = V * L * tr - borrow, income = V * L * inc;
      const flow = sum(flows.filter((f) => f.d === grid[k]), (f) => f.a);
      V += gain + flow;
      steps.push({ d: grid[k], gain, income, borrow, price: gain - income + borrow, flow, value: V });
    }
    const total = (lo, hi) => {
      const st = steps.filter((x) => x.d > lo && x.d <= hi);
      return { gain: sum(st, (x) => x.gain), income: sum(st, (x) => x.income), borrow: sum(st, (x) => x.borrow), price: sum(st, (x) => x.price), netFlow: sum(st, (x) => x.flow) };
    };
    return { ...total(w.start, w.end), begin: w.begin, end: V, steps, between: total, missing: [...missing] };
  }
  function pmeFor(A, w, rerender) {
    const cfg = bmCfg(A);
    const grid = pmeGrid(A, w);
    const key = JSON.stringify([cfg.components.map((c) => [c.symbol, c.weight]), cfg.leverage, cfg.borrowRate, grid]);
    if (pmeCache[key]) return pmeCache[key];
    pmeCache[key] = { status: "loading" };
    market({ kind: "benchmarks", dates: grid.join(","), symbols: cfg.components.map((c) => c.symbol).join(","), price: "1" })
      .then((m) => {
        if (m.connected === false) pmeCache[key] = { status: "off" };
        else if (m.error || !m.series) pmeCache[key] = { status: "error" };
        else pmeCache[key] = { status: "ready", res: pmeCompute(A, w, cfg, m, grid) };
      })
      .catch(() => { pmeCache[key] = { status: "error" }; })
      .finally(rerender);
    return pmeCache[key];
  }

  function benchmarkEditor(A, onApply) {
    const cat = A.benchmark.catalog, max = A.benchmark.max;
    const cfg = JSON.parse(JSON.stringify(bmCfg(A)));
    const box = h("div", { class: "bm-editor" });
    const rowsEl = h("div", { class: "bm-rows" });
    const totalEl = h("span", { class: "bm-total" });
    const msg = h("span", { class: "note inline", role: "status", "aria-live": "polite" });
    const listId = "bm-tickers-" + Math.random().toString(36).slice(2, 8);
    const datalist = h("datalist", { id: listId }, cat.map((c) => h("option", { value: c.symbol }, `${c.name} · ${c.group}`)));
    const lookups = {};
    const lookup = (sym) => {
      if (!lookups[sym]) lookups[sym] = market({ kind: "lookup", symbol: sym }).catch(() => ({ error: 1 }));
      return lookups[sym];
    };
    const total = () => cfg.components.reduce((a, c) => a + (Number(c.weight) || 0), 0);
    const paintTotal = () => {
      const t = Math.round(total() * 100) / 100;
      totalEl.textContent = `Total ${t}%`;
      totalEl.classList.toggle("bad", Math.abs(t - 100) > 0.01);
    };
    function paint() {
      rowsEl.replaceChildren(...cfg.components.map((c, i) => {
        const sel = h("input", { type: "text", class: "bm-ticker", list: listId, value: c.symbol, maxlength: "10", autocomplete: "off", spellcheck: "false", "aria-label": `Ticker ${i + 1}`, placeholder: "Ticker" });
        const info = h("small", { class: "muted" });
        const describe = () => {
          const known = cat.find((x) => x.symbol === c.symbol);
          if (known) { info.textContent = `${known.name}, via ${known.proxy}`; c.name = known.name; c.ok = true; return; }
          if (!c.symbol) { info.textContent = ""; c.ok = false; return; }
          info.textContent = "Checking…"; c.ok = null;
          const want = c.symbol;
          lookup(want).then((r) => {
            if (c.symbol !== want) return;
            if (r.connected === false) { info.textContent = "Ticker check needs the EODHD token; it will be checked when prices load."; c.ok = true; return; }
            if (r.error) { info.textContent = "Couldn't check this ticker right now."; c.ok = true; return; }
            if (!r.found) { info.textContent = `${want} wasn't found on a US exchange.`; info.classList.add("warn-text"); c.ok = false; return; }
            info.classList.remove("warn-text");
            c.name = r.name; c.ok = true; info.textContent = `${r.name}${r.type ? ` · ${r.type}` : ""}`;
          });
        };
        sel.addEventListener("change", () => { c.symbol = sel.value.trim().toUpperCase().replace(/\.US$/, ""); sel.value = c.symbol; c.name = null; info.classList.remove("warn-text"); describe(); });
        describe();
        const wt = h("input", { type: "number", min: "0", max: "100", step: "1", value: c.weight, "aria-label": `Weight for index ${i + 1}, percent` });
        wt.addEventListener("input", () => { c.weight = Number(wt.value); paintTotal(); });
        const rm = h("button", { type: "button", class: "link-button dark", "aria-label": `Remove index ${i + 1}`, disabled: cfg.components.length === 1 }, "Remove");
        rm.addEventListener("click", () => { cfg.components.splice(i, 1); paint(); });
        return h("div", { class: "bm-row" }, sel, h("label", { class: "bm-wt" }, wt, h("span", {}, "%")), rm, info);
      }));
      add.disabled = cfg.components.length >= max;
      paintTotal();
    }
    const add = h("button", { type: "button", class: "link-button dark" }, "+ Add ETF");
    add.addEventListener("click", () => { cfg.components.push({ symbol: "", weight: 0 }); paint(); const inputs = rowsEl.querySelectorAll(".bm-ticker"); inputs[inputs.length - 1].focus(); });
    const pos = A.positions;
    const acctLev = pos && pos.net > 0 ? pos.gross / pos.net : null;
    const lev = h("input", { type: "number", min: "0.5", max: "3", step: "0.05", value: cfg.leverage ?? 1 });
    lev.addEventListener("input", () => { cfg.leverage = Number(lev.value); });
    const rate = h("input", { type: "number", min: "0", max: "20", step: "0.05", value: cfg.borrowRate ?? 0 });
    rate.addEventListener("input", () => { cfg.borrowRate = Number(rate.value); });
    const levRow = h("div", { class: "tax-form bm-lev" },
      h("label", { class: "tax-field" }, h("span", {}, "Leverage (1.0 = none)"), lev, h("small", {}, acctLev ? `The account runs about ${acctLev.toFixed(2)}× (gross ÷ net) as of ${fmtDate(pos.asOf)}.` : "")),
      h("label", { class: "tax-field" }, h("span", {}, "Borrowing cost %"), rate, h("small", {}, "Charged on the levered portion only.")));
    const valid = () => {
      const live = cfg.components.filter((c) => c.weight > 0);
      if (live.some((c) => !/^[A-Z][A-Z0-9-]{0,9}$/.test(c.symbol || ""))) return "Enter a US ticker for each ETF with a weight, like SPY or JEPI.";
      if (live.some((c) => c.ok === false)) return `${live.find((c) => c.ok === false).symbol} wasn't found. Check the ticker.`;
      if (live.some((c) => c.ok == null)) return "Still checking a ticker; try again in a moment.";
      if (cfg.components.some((c) => !(Number(c.weight) >= 0))) return "Enter a weight for each index.";
      if (new Set(cfg.components.map((c) => c.symbol)).size !== cfg.components.length) return "Each index can appear only once.";
      if (Math.abs(total() - 100) > 0.01) return `Weights add up to ${Math.round(total() * 100) / 100}%; they need to total 100%.`;
      if (!(cfg.leverage >= 0.5 && cfg.leverage <= 3)) return "Leverage must be between 0.5× and 3×.";
      return null;
    };
    const apply = h("button", { type: "button", class: "btn-small" }, "Apply");
    apply.addEventListener("click", () => {
      const e = valid(); if (e) { msg.textContent = e; return; }
      bmDraft = { ...cfg, components: cfg.components.filter((c) => c.weight > 0).map((c) => ({ symbol: c.symbol, name: c.name || c.symbol, weight: c.weight })) };
      onApply();
    });
    const save = h("button", { type: "button", class: "btn-small ghost" }, "Save as default");
    save.addEventListener("click", async () => {
      const e = valid(); if (e) { msg.textContent = e; return; }
      const clean = { ...cfg, components: cfg.components.filter((c) => c.weight > 0).map((c) => ({ symbol: c.symbol, name: c.name || c.symbol, weight: c.weight })) };
      save.disabled = true; msg.textContent = "Saving…";
      try {
        const r = await fetch("/api/upload", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benchmark: clean }) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) { location.replace("/"); return; }
        if (!r.ok) { msg.textContent = d.error || "The blend couldn't be saved. Try again."; save.disabled = false; return; }
        A.benchmark.saved = clean; bmDraft = null; onApply();
      } catch { msg.textContent = "Can't reach the server. Check your connection and try again."; save.disabled = false; }
    });
    const reset = h("button", { type: "button", class: "link-button dark" }, "Reset to 60/40");
    reset.addEventListener("click", () => { bmDraft = JSON.parse(JSON.stringify(A.benchmark.defaults)); onApply(); });
    box.append(datalist, h("p", { class: "note" }, "Type any US-listed ETF ticker, or pick a suggestion. Weights must total 100%."), rowsEl, h("div", { class: "toolbar" }, add, totalEl), levRow, h("div", { class: "toolbar" }, apply, save, reset, msg));
    paint();
    return box;
  }

  function renderBenchmark(s, A, P, w, rerender) {
    const cfg = bmCfg(A);
    const saved = A.benchmark.saved;
    const isSaved = !bmDraft && !!saved;
    s.append(section("Benchmark proxy",
      "Blend up to six ETFs, any US ticker, into one benchmark. Returns use dividend-adjusted prices, so they include reinvested distributions net of each fund's fee. The blend is rebalanced to its weights at each statement date."));
    const det = h("details", { class: "bm-details" }, h("summary", {}, `${bmDraft ? "Trying" : isSaved ? "Saved blend" : "Default blend"}: ${bmLabel(A, cfg)}`));
    det.append(benchmarkEditor(A, rerender));
    if (bmDraft) det.open = true;
    s.append(det);
    if (isSaved && saved.savedBy) s.append(h("p", { class: "note" }, `Saved by ${saved.savedBy} on ${fmtDate(String(saved.savedAt || "").slice(0, 10))}. Apply tries a blend in this browser only; Save as default changes it for everyone.`));

    const kp = h("div");
    s.append(kp);
    s.append(section("Growth of $1", "The account's time-weighted path at each statement date against the benchmark proxy."));
    const { box, canvas } = chartBox(320);
    s.append(box);
    const bnote = h("p", { class: "note" }, "Loading benchmark…");
    s.append(bnote);
    const cmp = h("div");
    s.append(cmp);

    const labels = P.series.map((x) => fmtDate(x.date));
    const chart = draw(canvas, {
      type: "line", data: { labels, datasets: [{ label: "Blue Sky account (TWR)", data: P.series.map((x) => x.growth), borderColor: C.gold, backgroundColor: C.gold, borderWidth: 3, tension: 0.2, pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { y: { ticks: { callback: (v) => "$" + Number(v).toFixed(2) } } },
        plugins: { tooltip: { callbacks: { label: (c) => (c.raw == null ? `${c.dataset.label}: —` : `${c.dataset.label}: $${Number(c.raw).toFixed(3)} (${pct(c.raw - 1)})`) } } } },
    });

    bmFetch(A, cfg.components.map((c) => c.symbol)).then((m) => {
      if (!m.connected) { bnote.textContent = "The benchmark appears once the EODHD token (EODHD_API_TOKEN) is added to this site's Vercel project."; return; }
      if (m.error || !m.series) { bnote.textContent = "Benchmark prices are unavailable right now."; return; }
      const full = blendGrowth(A, cfg, m);
      const si = w.startIndex, ei = w.endIndex ?? full.length - 1, base = full[si];
      const win = full.slice(si, ei + 1).map((g) => (g == null || base == null ? null : g / base));
      if (chart) {
        chart.data.datasets.push({ label: `Benchmark: ${bmLabel(A, cfg)}`, data: win, borderColor: C.navy, backgroundColor: C.navy, borderWidth: 2.5, borderDash: [6, 4], tension: 0.2, pointRadius: 2 });
        if (cfg.components.length > 1) cfg.components.forEach((c, i) => {
          const ser = m.series[`${c.symbol}.US`];
          if (!ser || ser[si] == null) return;
          chart.data.datasets.push({ label: `${c.symbol} alone`, data: ser.slice(si, ei + 1).map((v) => (v == null ? null : v / ser[si])), borderColor: [C.haze, C.grey, C.sky, C.bronze, C.green, C.red][i % 6], borderWidth: 1, tension: 0.2, pointRadius: 0, hidden: true });
        });
        chart.update();
      }
      const bRet = win[win.length - 1] == null ? null : win[win.length - 1] - 1;
      const long = P.days >= 365;
      const ann = (r, d) => (r == null ? null : Math.pow(1 + r, 365 / d) - 1);
      kp.replaceChildren(kpis([
        { label: `Account, ${P.label}`, value: pct(P.twr), sub: "time-weighted" },
        { label: `Benchmark, ${P.label}`, value: pct(bRet), sub: long ? `${pct(ann(bRet, P.days))} annualized` : `cumulative over ${P.days} days` },
        { label: "Account vs benchmark", value: bRet == null ? "—" : (P.twr - bRet >= 0 ? "+" : "") + pct(P.twr - bRet), sub: "percentage points", lead: true },
      ]));
      bnote.textContent = `Benchmark: ${bmLabel(A, cfg)}${cfg.leverage && cfg.leverage !== 1 ? `, borrowing at ${cfg.borrowRate}%` : ""}. Single indices are in the legend; click one to show it.${P.estimated ? " The account's first period is an estimate (see note below)." : ""}`;

      const rows = windowsOf(A).filter((x) => x.available).map((x) => {
        const b0 = full[x.startIndex], b1 = full[x.endIndex ?? full.length - 1];
        const br = b0 == null || b1 == null ? null : b1 / b0 - 1;
        return { ...x, br, ex: br == null ? null : x.twr - br, _class: x.key === w.key ? "sum" : null };
      });
      cmp.replaceChildren(section("Account vs benchmark by period"), table([
        { label: "Period", get: (r) => h("strong", {}, r.label) },
        { label: "From", num: 1, get: (r) => fmtDate(addDaysIso(r.start, 1)) },
        { label: "Account (TWR)", num: 1, get: (r) => pct(r.twr) + (r.estimated ? " *" : ""), raw: (r) => r.twr },
        { label: "Benchmark", num: 1, get: (r) => pct(r.br), raw: (r) => r.br },
        { label: "Difference", num: 1, get: (r) => (r.ex == null ? "—" : (r.ex >= 0 ? "+" : "") + pct(r.ex)), raw: (r) => r.ex },
      ], rows));
    });
  }

  /* ---------- calendar-month gains (Gains & Losses chart and popout) ---------- */
  // Each statement period is split into the calendar months it covers. Income, margin interest and
  // realized results are dated, so they split exactly; unrealized change and total gain only exist
  // per statement period, so a period spanning several months is reported as one combined group.
  function monthlyGains(A, from, to) {
    const P = A.performance;
    const items = A.income.items;
    const lots = Object.values(A.realized).flatMap((r) => r.detail);
    const months = [], groups = [];
    P.periods.filter((p) => p.start >= from && p.end <= to).forEach((p) => {
      const first = addDaysIso(p.start, 1).slice(0, 7), lastM = p.end.slice(0, 7);
      const ms = [];
      for (let m = first; m <= lastM; m = addDaysIso(monthEnd(m), 1).slice(0, 7)) ms.push(m);
      let group = null;
      if (ms.length > 1) {
        group = { label: `${MON[+ms[0].slice(5) - 1]}–${MON[+lastM.slice(5) - 1]} ${lastM.slice(0, 4)}`, start: p.start, end: p.end, begin: p.begin, endValue: p.end_value, netFlow: p.netFlow,
          income: p.income, interest: p.interest, realized: p.realized, unrealized: p.unrealized, gain: p.gain, ret: p.ret, estimated: p.flowHeavy,
          missing: ms.slice(0, -1).map(monthEnd) };
        groups.push(group);
      }
      ms.forEach((m, i) => {
        const lo = i === 0 ? p.start : prevMonthEnd(m), hi = i === ms.length - 1 ? p.end : monthEnd(m);
        const inR = (d) => d > lo && d <= hi;
        const it = items.filter((x) => inR(x.d));
        const income = sum(it.filter((x) => x.k !== "Margin interest"), (x) => x.a), interest = sum(it.filter((x) => x.k === "Margin interest"), (x) => x.a);
        const realized = sum(lots.filter((l) => inR(l.c)), (l) => l.g);
        const partial = hi !== monthEnd(m);
        const mi = +m.slice(5) - 1, yy = m.slice(0, 4);
        const row = { month: m, label: `${MON[mi]} ${yy}${partial ? ` (to ${fmtDate(hi)})` : ""}`, short: `${MON[mi]} '${yy.slice(2)}${partial ? "*" : ""}`, lo, hi, income, interest, realized, group, groupLast: group && i === ms.length - 1 };
        if (!group) Object.assign(row, { begin: p.begin, endValue: p.end_value, netFlow: p.netFlow, unrealized: p.unrealized, gain: p.gain, ret: p.ret, estimated: p.flowHeavy });
        months.push(row);
      });
    });
    return { months, groups };
  }
  function monthlyDialog(MG, P) {
    const dlg = h("dialog", { class: "bs-dialog", "aria-labelledby": "mg-title" });
    const close = h("button", { type: "button", class: "link-button dark", "aria-label": "Close" }, "Close");
    close.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    const rows = [];
    MG.months.forEach((m) => {
      rows.push(m);
      if (m.groupLast) rows.push({ ...m.group, label: `${m.group.label} combined`, _class: "sum", isGroup: true });
    });
    const dash = (r, v) => (r.group && !r.isGroup ? h("span", { class: "muted" }, "combined") : v);
    const gainSum = sum(MG.months.filter((m) => !m.group), (m) => m.gain) + sum(MG.groups, (g) => g.gain);
    const tot = { income: sum(MG.months, (m) => m.income), interest: sum(MG.months, (m) => m.interest), realized: sum(MG.months, (m) => m.realized),
      unrealized: sum(MG.months.filter((m) => !m.group), (m) => m.unrealized) + sum(MG.groups, (g) => g.unrealized), net: sum(MG.months.filter((m) => !m.group), (m) => m.netFlow) + sum(MG.groups, (g) => g.netFlow) };
    const X = MG.layer && MG.layer !== "portfolio", full = MG.layer === "full";
    const pv = (r, k) => (r.isGroup ? r.prop[k] : r.prop[k]);
    const cols = [
      { label: "Month", get: (r) => (r.isGroup ? h("strong", {}, r.label) : r.label), total: "Total" },
      { label: "Begin value", num: 1, get: (r) => dash(r, usd(r.begin)), total: "" },
      { label: "Net deposits", num: 1, get: (r) => dash(r, usd(r.netFlow)), raw: (r) => (r.group && !r.isGroup ? null : r.netFlow), total: usd(tot.net) },
      { label: "Income", num: 1, get: (r) => usd(r.income), total: usd(tot.income) },
      { label: "Margin interest", num: 1, get: (r) => usd(r.interest), raw: (r) => r.interest, total: usd(tot.interest) },
      { label: "Realized", num: 1, get: (r) => usd(r.realized), raw: (r) => r.realized, total: usd(tot.realized) },
      { label: "Unrealized", num: 1, get: (r) => dash(r, usd(r.unrealized)), raw: (r) => (r.group && !r.isGroup ? null : r.unrealized), total: usd(tot.unrealized) },
      { label: X ? "Portfolio gain" : "Total gain / loss", num: 1, get: (r) => dash(r, X ? usd(r.gain) : h("strong", {}, usd(r.gain))), raw: (r) => (r.group && !r.isGroup ? null : r.gain), total: usd(gainSum) },
      { label: "Return", num: 1, get: (r) => dash(r, pct(r.ret) + (r.estimated ? " *" : "")), raw: (r) => (r.group && !r.isGroup ? null : r.ret), total: pct(P.twr) },
    ];
    if (X) {
      // Property amounts are exact by month; group rows repeat the sum of their months, so totals use months only.
      const pt = (k) => sum(MG.months, (m) => m.prop[k]);
      const econTot = gainSum + pt("economic");
      cols.push({ label: "Rent", num: 1, get: (r) => usd(pv(r, "rent")), total: usd(pt("rent")) });
      if (full) cols.push(
        { label: "Property costs", num: 1, get: (r) => usd(-pv(r, "costs")), raw: (r) => -pv(r, "costs"), total: usd(-pt("costs")) },
        { label: "Mortgage interest", num: 1, get: (r) => usd(-pv(r, "interest")), raw: (r) => -pv(r, "interest"), total: usd(-pt("interest")) });
      cols.push({ label: "Combined result", num: 1, get: (r) => dash(r, h("strong", {}, usd(r.gain + pv(r, "economic")))), raw: (r) => (r.group && !r.isGroup ? null : r.gain + pv(r, "economic")), total: usd(econTot) });
      if (full) cols.push(
        { label: "Principal paid", num: 1, get: (r) => usd(pv(r, "principal") + pv(r, "balloon")), total: usd(pt("principal") + pt("balloon")) },
        { label: "Property net cash", num: 1, get: (r) => usd(pv(r, "netCash")), raw: (r) => pv(r, "netCash"), total: usd(pt("netCash")) });
    }
    if (MG.pme) {
      const pe = (r) => (r.prop ? r.prop.economic : 0);
      const pmT = sum(MG.months, (m) => m.pme.gain), peT = X ? sum(MG.months, (m) => m.prop.economic) : 0;
      const actT = gainSum + peT;
      cols.push(
        { label: X ? "Benchmark + property" : "Benchmark equivalent", num: 1, get: (r) => usd(r.pme.gain + pe(r)), raw: (r) => r.pme.gain + pe(r), total: usd(pmT + peT) },
        { label: "Difference", num: 1, get: (r) => dash(r, ((r.gain - r.pme.gain) >= 0 ? "+" : "") + usd(r.gain - r.pme.gain)), raw: (r) => (r.group && !r.isGroup ? null : r.gain - r.pme.gain), total: ((actT - pmT - peT) >= 0 ? "+" : "") + usd(actT - pmT - peT) });
    }
    const body = h("div", { class: "bs-dialog-body" },
      h("div", { class: "bs-dialog-head" }, h("h3", { id: "mg-title" }, `Gain and loss by month, ${P.label}${X ? ` · portfolio + ${MG.propName}` : ""}`), close),
      table(cols, rows, { foot: {} }));
    dlg.append(body);
    const foot = body.querySelector("tfoot tr");
    if (foot) cols.forEach((c, i) => { const v = c.total ?? ""; foot.children[i].textContent = v; foot.children[i].classList.toggle("neg", String(v).startsWith("−")); });
    if (MG.groups.length) body.append(h("p", { class: "note" }, `Months marked "combined" share one statement period because the ${MG.groups.map((g) => g.missing.map(fmtDate).join(", ")).join(", ")} account value isn't on file. Their income, margin interest and realized figures are exact; the unrealized change and total are shown on the combined row. Enter the statement value on the Upload page to split them.`));
    if (MG.months.some((m) => m.estimated || (m.group && m.group.estimated))) body.append(h("p", { class: "note" }, "* The 3/2 wire landed inside this period, so the return is a cash-flow-weighted estimate."));
    if (MG.months.some((m) => m.hi !== monthEnd(m.month))) body.append(h("p", { class: "note" }, "Months marked with a date run only to the latest account value."));
    document.body.append(dlg);
    dlg.showModal();
  }

  /* ================= PERFORMANCE ================= */
  function renderPerformance(root, A) {
    const rerender = () => renderPerformance(root, A);
    const w = pickWindow(A, "perf");
    if (!w) return unavailable(root, "Performance", A, "perf", rerender);
    const P = perfView(A, w);
    const long = P.days >= 365;
    const s = sheet("Performance", `Account …965, ${fmtDate(addDaysIso(P.start, 1))} through ${fmtDate(P.end)}. Returns are measured on net equity, after the margin loan, so they include the effect of leverage.`);
    s.append(periodBar(A, "perf", rerender));
    const inote = inceptionNote(A); if (inote) s.append(inote);
    s.append(kpis([
      { label: `Time-weighted return, ${P.label}`, value: pct(P.twr), sub: long ? `${pct(P.twrAnnualized)} annualized` : `cumulative over ${P.days} days`, lead: true },
      { label: `Money-weighted return, ${P.label}`, value: pct(P.mwr), sub: long ? "annualized, on your actual dollars" : `for the period; ${pct(P.mwrAnnualized)} if annualized` },
      { label: "Gain", value: usd(P.totalGain), sub: "after margin interest" },
      { label: "Net money added", value: usd(P.netContributions), sub: "deposits less withdrawals" },
      { label: "Account value", value: usd(P.endValue), sub: `net equity on ${fmtDate(P.end)}` },
    ]));
    s.append(h("div", { class: "explain" },
      h("p", {}, h("strong", {}, "Time-weighted "), "measures the strategy itself. It links each month's return and ignores when money went in or out, so it's the number to compare with a benchmark or a manager's target."),
      h("p", {}, h("strong", {}, "Money-weighted "), "measures what your dollars earned. It counts timing: money added before a down month lowers it. When the two differ, timing of deposits and withdrawals is the reason. Periods under a year are shown as-is, not annualized.")));

    s.append(section("Returns by period", "Every standard window at once. Longer windows fill in as history builds."));
    s.append(table([
      { label: "Period", get: (r) => h("strong", {}, r.label) },
      { label: "From", num: 1, get: (r) => (r.available ? fmtDate(addDaysIso(r.start, 1)) : "—") },
      { label: "Time-weighted", num: 1, get: (r) => (r.available ? pct(r.twr) + (r.estimated ? " *" : "") : "—"), raw: (r) => (r.available ? r.twr : null) },
      { label: "Annualized", num: 1, get: (r) => (r.available && r.twrAnnualized != null ? pct(r.twrAnnualized) : "—"), raw: (r) => r.twrAnnualized },
      { label: "Money-weighted", num: 1, get: (r) => (r.available ? pct(r.mwr) : "—"), raw: (r) => (r.available ? r.mwr : null) },
      { label: "Gain", num: 1, get: (r) => (r.available ? usd(r.gain) : "—"), raw: (r) => (r.available ? r.gain : null) },
      { label: "Income", num: 1, get: (r) => (r.available ? usd(r.income) : "—") },
      { label: "", get: (r) => (r.available ? "" : h("span", { class: "muted" }, isoToUs(r.reason))) },
    ], windowsOf(A).map((r) => ({ ...r, _class: r.key === w.key ? "sum" : null }))));

    renderBenchmark(s, A, P, w, rerender);

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
    if (P.periods.some((x) => x.flowHeavy) || windowsOf(A).some((x) => x.estimated)) s.append(h("p", { class: "note" }, "* The $1.51M wire on 3/2 landed in the first period (inception to 4/30), so that return is a cash-flow-weighted estimate (Modified Dietz), not statement-to-statement" + (A.inception && A.inception.estimated ? ", and it starts from an estimated 2/28 value" : "") + ". Adding the 3/31 statement value (and the 2/28 value, if missing) on the Upload page makes it exact."));

    s.append(section("Where the gain came from"));
    const { box: b2, canvas: c2 } = chartBox(220);
    s.append(b2);
    draw(c2, {
      type: "bar",
      data: { labels: ["Income", "Margin interest", "Realized gains/losses", "Unrealized gains/losses", "Total gain"],
        datasets: [{ data: [P.income, P.interest, P.realized, P.unrealized, P.totalGain], backgroundColor: [C.green, C.red, P.realized < 0 ? C.red : C.green, P.unrealized < 0 ? C.red : C.green, C.gold] }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => usd(c.raw) } } }, scales: { x: { ticks: { callback: moneyTick } } } },
    });
    s.append(h("p", { class: "note" }, `Over this period, distributions brought in ${usd(P.income)} and margin interest cost ${usd(-P.interest)}. Price movement was ${usd(P.marketChange)}: ${usd(P.realized)} realized from sales and ${usd(P.unrealized)} unrealized in holdings.`));
    root.replaceChildren(s);
  }

  /* ================= GAINS & LOSSES ================= */
  function renderGains(root, A) {
    const rerender = () => renderGains(root, A);
    const w = pickWindow(A, "perf");
    if (!w) return unavailable(root, "Gains & losses", A, "perf", rerender);
    const P = perfView(A, w), pos = A.positions;
    const R = realizedView(A, w.start, w.end);
    if (gLayer !== "portfolio" && window.BSProps && !window.BSProps.data && !propsRequested) {
      propsRequested = true;
      window.BSProps.load().then(() => { if (location.hash.replace("#", "") === "gains" || !location.hash) rerender(); }).catch(() => {});
    }
    const s = sheet("Gains & losses", "Dollar results: what you made, how much is realized and what's still open in current positions.");
    s.append(periodBar(A, "perf", rerender));
    s.append(layerBar(rerender));
    s.append(kpis([
      { label: `Gain, ${P.label}`, value: usd(P.totalGain), sub: `${fmtDate(addDaysIso(P.start, 1))} – ${fmtDate(P.end)}`, lead: true },
      { label: "Realized (net)", value: usd(R.net), sub: `${usd(R.gains)} gains, ${usd(R.losses)} losses` },
      { label: "Change in unrealized", value: usd(P.unrealized), sub: pos ? `open gain today ${usd(sum(pos.holdings, (x) => x.gain))}` : "" },
      { label: "Income received", value: usd(P.income), sub: "distributions and interest" },
      { label: "Margin interest", value: usd(P.interest), sub: "paid on the loan" },
    ]));
    const X = propLayer(w.start, w.end);
    if (X) {
      const full = gLayer === "full";
      s.append(section(`Portfolio + ${X.name}, ${P.label}`, full
        ? "Combined result = portfolio gain + rent − property costs − mortgage interest. Principal is shown separately: it's cash out the door but it pays down the loan, so it isn't a loss. Property net cash is what the building put in or took out of the bank."
        : "Combined result = portfolio gain + rent received. Choose \u201c+ Rents, costs & mortgage\u201d to net out property costs and the mortgage."));
      const items = [
        { label: "Combined result", value: usd(P.totalGain + X.economic), sub: `${fmtDate(addDaysIso(P.start, 1))} – ${fmtDate(P.end)}`, lead: true },
        { label: "Portfolio gain", value: usd(P.totalGain) },
        { label: "Rent received", value: usd(X.rent) },
      ];
      if (full) items.push(
        { label: "Property costs", value: usd(-X.costs), sub: "taxes, insurance, repairs, other" },
        { label: "Mortgage interest", value: usd(-X.interest), sub: X.payment ? `${usd(X.payment)} of payments` : "no mortgage payments in period" },
        { label: "Principal paid", value: usd(X.principal + X.balloon), sub: "pays down the loan; not a cost" },
        { label: "Property net cash", value: usd(X.netCash), sub: "rent − costs − mortgage payments" });
      s.append(kpis(items));
      if (!X.entries && !X.payment) s.append(h("p", { class: "note" }, `No ${full ? "rent, expenses or mortgage payments" : "rent"} are on file for ${X.name} in this period. Add them on the Properties tab.`));
    }

    const PM = pmeFor(A, w, () => { if (root.contains(s)) rerender(); });
    const PR = PM.status === "ready" && !PM.res.missing.length ? PM.res : null;
    s.append(section("Public market equivalent", `What the same dollars would have done in the benchmark: the account's ${usd(w.begin)} on ${fmtDate(w.start)}, plus every deposit and withdrawal on the day it happened, invested in ${bmLabel(A, bmCfg(A))}. Change the blend on the Performance tab.`));
    if (PM.status === "loading") s.append(h("p", { class: "note" }, "Loading benchmark prices…"));
    else if (PM.status === "off") s.append(h("p", { class: "note" }, "Add the EODHD token to the Vercel project to turn on the benchmark comparison."));
    else if (PM.status === "error") s.append(h("p", { class: "note" }, "Benchmark prices are unavailable right now."));
    else if (!PR) s.append(h("p", { class: "note" }, `Price history for ${PM.res.missing.join(", ")} doesn't cover this period, so the comparison can't be drawn. Pick a later period or a different ETF.`));
    else {
      const diff = P.totalGain - PR.gain;
      s.append(kpis([
        { label: "Benchmark-equivalent gain", value: usd(PR.gain), sub: `ending value ${usd(PR.end)}`, lead: true },
        { label: "Account vs benchmark", value: (diff >= 0 ? "+" : "") + usd(diff), sub: diff >= 0 ? "account ahead" : "account behind" },
        { label: "Benchmark income", value: usd(PR.income), sub: `account: ${usd(P.income)}` },
        { label: "Benchmark price change", value: usd(PR.price), sub: `account: ${usd(P.realized + P.unrealized)}` },
      ]));
      const rows = [
        { l: "Ending value", a: w.endValue, b: PR.end },
        { l: "Income (distributions and interest)", a: P.income, b: PR.income },
        { l: "Price change (realized + unrealized)", a: P.realized + P.unrealized, b: PR.price },
        { l: "Borrowing cost", a: P.interest, b: -PR.borrow },
        { l: "Total gain", a: P.totalGain, b: PR.gain, _class: "sum" },
      ];
      if (X) rows.push({ l: `Combined with ${X.name} (${gLayer === "full" ? "rent, costs, mortgage interest" : "rent"})`, a: P.totalGain + X.economic, b: PR.gain + X.economic, _class: "total" });
      s.append(table([
        { label: "", get: (r) => r.l },
        { label: "Account", num: 1, get: (r) => usd(r.a), raw: (r) => r.a },
        { label: "Benchmark equivalent", num: 1, get: (r) => usd(r.b), raw: (r) => r.b },
        { label: "Difference", num: 1, get: (r) => (r.a - r.b >= 0 ? "+" : "") + usd(r.a - r.b), raw: (r) => r.a - r.b },
      ], rows));
      s.append(h("p", { class: "note" }, `Net deposits in the period: ${usd(PR.netFlow)}, applied to both on the same dates.${(bmCfg(A).leverage || 1) !== 1 ? ` The benchmark is levered ${bmCfg(A).leverage}× at ${bmCfg(A).borrowRate}%.` : " The benchmark isn't levered; set leverage on the Performance tab to match the margin."} Benchmark income is estimated from each ETF's distributions; the property layer is identical on both sides.`));
    }

    const MG = monthlyGains(A, w.start, w.end);
    if (PR) { MG.pme = PR; MG.months.forEach((m) => { m.pme = PR.between(m.lo, m.hi); }); MG.groups.forEach((g) => { g.pme = PR.between(g.start, g.end); }); }
    if (X) { MG.months.forEach((m) => { m.prop = propLayer(m.lo, m.hi); }); MG.groups.forEach((g) => { g.prop = propLayer(g.start, g.end); }); MG.layer = gLayer; MG.propName = X.name; }
    const mgSec = section("Monthly gain, by source", "Calendar months. Income, margin interest and realized results are exact by date. The change in unrealized gains needs an account value at each month-end.");
    const openBtn = h("button", { type: "button", class: "btn-small" }, "Month-by-month totals");
    mgSec.append(h("div", { class: "toolbar" }, openBtn, h("span", { class: "note inline" }, "Or click any bar.")));
    s.append(mgSec);
    const { box, canvas } = chartBox(320);
    s.append(box);
    const showTotals = () => monthlyDialog(MG, P);
    const propSets = X ? [
      { label: "Rent", data: MG.months.map((m) => m.prop.rent), backgroundColor: C.gold, stack: "g" },
      ...(gLayer === "full" ? [
        { label: "Property costs", data: MG.months.map((m) => -m.prop.costs), backgroundColor: "#7d6aa8", stack: "g" },
        { label: "Mortgage interest", data: MG.months.map((m) => -m.prop.interest), backgroundColor: "#5b6b85", stack: "g" }] : []),
    ] : [];
    openBtn.addEventListener("click", showTotals);
    const mrows = MG.months;
    draw(canvas, {
      type: "bar",
      data: { labels: mrows.map((m) => m.short), datasets: [
        { label: "Income", data: mrows.map((m) => m.income), backgroundColor: C.green, stack: "g" },
        { label: "Margin interest", data: mrows.map((m) => m.interest), backgroundColor: C.bronze, stack: "g" },
        { label: "Realized", data: mrows.map((m) => m.realized), backgroundColor: C.red, stack: "g" },
        { label: "Unrealized", data: mrows.map((m) => (m.group ? 0 : m.unrealized)), backgroundColor: C.haze, stack: "g" },
        ...propSets,
        ...(PR ? [{ type: "line", label: X ? "Benchmark equivalent + property" : "Benchmark-equivalent gain", data: mrows.map((m) => m.pme.gain + (m.prop ? m.prop.economic : 0)), borderColor: C.navy, backgroundColor: C.navy, pointRadius: 3, borderWidth: 2, stack: "pme", order: -1 }] : []),
        ...(MG.groups.length ? [{ label: "Unrealized, months combined", data: mrows.map((m) => (m.group && m.groupLast ? m.group.unrealized : 0)), backgroundColor: "#c9d8ec", borderColor: C.sky, borderWidth: 1, stack: "g" }] : []),
      ] },
      options: { responsive: true, maintainAspectRatio: false, onClick: showTotals, interaction: { mode: "index", intersect: false },
        plugins: { tooltip: { filter: (c) => !!c.raw, callbacks: {
          label: (c) => `${c.dataset.label}: ${usd(c.raw)}`,
          afterBody: (items) => { if (!items.length) return []; const m = mrows[items[0].dataIndex]; const pe = m.prop ? m.prop.economic : 0;
            return m.group ? [`Unrealized for ${m.group.label} is combined: ${usd(m.group.unrealized)}`, `${m.group.label} portfolio gain: ${usd(m.group.gain)}`].concat(m.prop ? [`${m.group.label} combined result: ${usd(m.group.gain + m.group.prop.economic)}`] : [])
              : m.prop ? [`Portfolio gain: ${usd(m.gain)}`, `Combined result: ${usd(m.gain + pe)}`] : [`Total gain: ${usd(m.gain)}`]; },
        } } },
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } },
    });
    if (MG.groups.length) s.append(h("p", { class: "note" }, `${MG.groups.map((g) => g.label).join(", ")}: the unrealized change can't be split by month until the ${MG.groups.map((g) => g.missing.map(fmtDate).join(", ")).join(", ")} statement value is entered on the Upload page, so it's shown once, in the lighter bar.`));

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

    s.append(section(`Realized gains and losses by fund, ${P.label}`, R.count ? `${R.count} lots closed ${fmtDate(addDaysIso(P.start, 1))} – ${fmtDate(P.end)}, including funds since sold.` : "No sales closed in this period."));
    if (R.count) s.append(table([
      { label: "Fund", get: (r) => h("span", {}, h("strong", {}, r.symbol), " ", h("span", { class: "muted" }, r.name)) },
      { label: "Lots", num: 1, get: (r) => r.lots },
      { label: "Proceeds", num: 1, get: (r) => usd(r.proceeds) },
      { label: "Cost", num: 1, get: (r) => usd(r.cost) },
      { label: "Gain / loss", num: 1, get: (r) => usd(r.gain), raw: (r) => r.gain },
      { label: "Wash-sale lots", num: 1, get: (r) => r.washLots || "" },
      { label: "Loss deferred", num: 1, get: (r) => (r.disallowed ? usd(r.disallowed) : "") },
    ], R.bySymbol));
    root.replaceChildren(s);
  }

  /* ================= INCOME ================= */
  function renderIncome(root, A) {
    const rerender = () => renderIncome(root, A);
    const w = pickWindow(A, "cash");
    if (!w) return unavailable(root, "Income", A, "cash", rerender);
    const from = w.cashStart, to = w.cashEnd || w.end;
    const items = A.income.items.filter((x) => x.d > from && x.d <= to);
    const inc = items.filter((x) => x.k !== "Margin interest");
    const total = sum(inc, (x) => x.a), interestPaid = sum(items.filter((x) => x.k === "Margin interest"), (x) => x.a);
    const monthsSpan = Math.max(1, (new Date(to) - new Date(from)) / (30.4375 * 864e5));
    const byMonth = {};
    inc.forEach((x) => { const m = x.d.slice(0, 7); byMonth[m] = byMonth[m] || {}; byMonth[m][x.k] = (byMonth[m][x.k] || 0) + x.a; });
    const months = Object.keys(byMonth).sort();
    const cats = [...new Set(inc.map((x) => x.k))];
    const s = sheet("Income", "Distributions and interest received, by month and by tax character as Schwab reports it today. Final character comes on the 1099.");
    s.append(periodBar(A, "cash", rerender));
    s.append(kpis([
      { label: `Income, ${w.label}`, value: usd(total), sub: `${fmtDate(addDaysIso(from, 1))} – ${fmtDate(to)}`, lead: true },
      { label: "Margin interest paid", value: usd(interestPaid) },
      { label: "Income after margin interest", value: usd(total + interestPaid) },
      { label: "Monthly average", value: usd(total / monthsSpan), sub: `over ${monthsSpan < 1.5 ? "the period" : Math.round(monthsSpan) + " months"}` },
    ]));
    if (w.clamped || w.key === "ITD") s.append(h("p", { class: "note" }, `Shown from inception (${fmtDate(A.inception && A.inception.date)}). The Tax tab covers the full calendar year, including January and February.`));
    const palette = [C.green, C.navy, C.gold, C.haze, C.bronze, C.grey, C.sky];
    const { box, canvas } = chartBox(300);
    s.append(section("Income by month"), box);
    draw(canvas, {
      type: "bar",
      data: { labels: months.map(monthLabel), datasets: cats.map((k, i) => ({ label: k, data: months.map((m) => byMonth[m][k] || 0), backgroundColor: palette[i % palette.length], stack: "i" })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } } },
    });
    const bySym = {};
    inc.forEach((x) => { const k = x.s || "(cash)"; bySym[k] = (bySym[k] || 0) + x.a; });
    s.append(section(`Income by fund, ${w.label}`));
    s.append(table([{ label: "Fund", get: (r) => r.symbol }, { label: "Received", num: 1, get: (r) => usd(r.amount, 2) }, { label: "Share", num: 1, get: (r) => pct(total ? r.amount / total : 0, 1) }],
      Object.entries(bySym).map(([symbol, amount]) => ({ symbol, amount })).sort((a, b) => b.amount - a.amount)));
    const byChar = {};
    inc.forEach((x) => { byChar[x.k] = (byChar[x.k] || 0) + x.a; });
    s.append(section(`Income by tax character, ${w.label}`));
    s.append(table([{ label: "Character", get: (r) => r.k }, { label: "Amount", num: 1, get: (r) => usd(r.a, 2) }, { label: "Share", num: 1, get: (r) => pct(total ? r.a / total : 0, 1) }],
      Object.entries(byChar).map(([k, a]) => ({ k, a })).sort((a, b) => b.a - a.a)));
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

    const s = sheet(`Tax picture, calendar ${year}`, `Full tax year: realized results ${fmtDate(R.from || year + "-01-01")} through ${fmtDate(R.to)} and all income received in ${year}, including the months before the ${fmtDate(A.inception && A.inception.date)} performance inception. An estimate to review with Jason, not tax advice; final character comes from the ${year} 1099.`);
    s.append(kpis([
      { label: "Net realized", value: usd(R.net), sub: `${usd(R.st)} short-term, ${usd(R.lt)} long-term`, lead: true },
      { label: "Realized gains", value: usd(R.gains) },
      { label: "Realized losses", value: usd(R.losses) },
      { label: "Wash-sale losses deferred", value: usd(R.disallowed), sub: `${R.washLots} lots; added to replacement shares' basis` },
      { label: "Margin interest paid", value: usd(interestPaid), sub: "investment interest expense" },
    ]));

    // Before vs since inception, so the tax year ties to the performance window
    const inc0 = (A.inception && A.inception.date) || `${year}-01-01`;
    const yItems = A.income.items.filter((x) => x.d.startsWith(year));
    const split = (pred) => {
      const it = yItems.filter((x) => pred(x.d));
      const lots = (R.detail || []).filter((l) => pred(l.c));
      return { income: sum(it.filter((x) => x.k !== "Margin interest"), (x) => x.a), interest: sum(it.filter((x) => x.k === "Margin interest"), (x) => x.a),
        st: sum(lots.filter((l) => l.t === "ST"), (l) => l.g), lt: sum(lots.filter((l) => l.t === "LT"), (l) => l.g), lots: lots.length };
    };
    if (inc0 > `${year}-01-01` && inc0.startsWith(year)) {
      const pre = split((d) => d < inc0), post = split((d) => d >= inc0);
      const tot = { income: pre.income + post.income, interest: pre.interest + post.interest, st: pre.st + post.st, lt: pre.lt + post.lt, lots: pre.lots + post.lots };
      s.append(section(`Tax year ${year}, before and since inception`, `Performance starts ${fmtDate(inc0)}; taxes don't. Everything in ${year} counts.`));
      const row = (label, x, cls) => ({ label, ...x, _class: cls });
      s.append(table([
        { label: "", get: (r) => r.label },
        { label: "Income", num: 1, get: (r) => usd(r.income) },
        { label: "Margin interest", num: 1, get: (r) => usd(r.interest), raw: (r) => r.interest },
        { label: "Short-term realized", num: 1, get: (r) => usd(r.st), raw: (r) => r.st },
        { label: "Long-term realized", num: 1, get: (r) => usd(r.lt), raw: (r) => r.lt },
        { label: "Closed lots", num: 1, get: (r) => r.lots },
      ], [row(`1/1 – ${fmtDate(addDaysIso(inc0, -1))} (before inception)`, pre), row(`${fmtDate(inc0)} – ${fmtDate(R.to)} (since inception)`, post), row(`Calendar ${year}`, tot, "sum")]));
    }

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
