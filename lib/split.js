// Account Split: divides the Schwab account into its two sources of money and traces margin debt by use.
//
//  1. Sleeves. "5100 Main" is the refinance wire that funded the strip; "Legacy" is everything else
//     (the account value before the wire plus every later deposit and withdrawal, all Jen's own funds).
//     Each period between valuation points (statement month-ends, positions exports) splits that
//     period's gain by each sleeve's time-weighted capital (Modified Dietz), and the sleeve balances are
//     carried forward period by period. Margin interest is shared through the gain, except the part of a
//     charge that accrued before the wire, which belongs to the Legacy account alone.
//
//  2. Margin tracing. The daily cash balance is rebuilt from a positions snapshot and the transactions.
//     New margin borrowing takes the use of the payment that caused it (a withdrawal: its stated use,
//     personal by default; a purchase: investment). Cash coming in repays margin in the regulatory
//     order (Treas. Reg. 1.163-8T(d)): personal first, then investment, then rental property.
//     Each month's margin interest is split by the average daily balance of each use.
//
// Pure functions: no storage access, so this runs the same in the API and in tests.

import { computeAnalytics, isFlow } from "./analytics.js";

const DAY = 86400000;
const t = (iso) => Date.parse(iso + "T00:00:00Z");
const days = (a, b) => Math.round((t(b) - t(a)) / DAY);
const addDays = (iso, n) => new Date(t(iso) + n * DAY).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);

export const SLEEVES = { legacy: "Legacy", main: "5100 Main" };
export const USES = { personal: "Personal", investment: "Investment", rental: "Rental property" };
const REPAY_ORDER = ["personal", "investment", "rental"]; // 1.163-8T(d)(1)
export const DEFAULT_AS_OF = "2026-09-30";
export const DEFAULT_SETTINGS = { version: 0, asOf: DEFAULT_AS_OF, newAccount: "main", carriedIn: "investment", flows: {} };

export const valueDate = (tx) => tx.asOf || tx.date;
const isMarginCharge = (tx) => tx.action === "Margin Interest";
const isMarginAdj = (tx) => tx.action === "Margin Interest Adj";

// Stable key for a cash flow: survives re-uploads of overlapping Transactions exports.
export function flowKeys(flows) {
  const seen = {};
  return flows.map((f) => {
    const base = `${f.date}|${f.action}|${f.amount.toFixed(2)}`;
    seen[base] = (seen[base] || 0) + 1;
    return `${base}|${seen[base]}`;
  });
}

export function counterparty(tx) {
  const d = `${tx.action} ${tx.description}`.toUpperCase();
  if (/WIRE/.test(d)) return "Wire";
  if (/HEARTLAND/.test(d)) return "Heartland Bank";
  const acct = d.match(/\.\.\.(\d{3,4})/);
  if (acct) return /SCHWAB BANK/.test(d) ? `Schwab Bank …${acct[1]}` : `Schwab …${acct[1]}`;
  return tx.action;
}

// "INTEREST 08/28THRU 09/28" -> { from, to } in the right year(s)
export function billingPeriod(tx) {
  const m = String(tx.description || "").match(/(\d{1,2})\/(\d{1,2})\s*THRU\s*(\d{1,2})\/(\d{1,2})/i);
  if (!m) return null;
  const y = +tx.date.slice(0, 4), cm = +tx.date.slice(5, 7);
  const toY = +m[3] > cm ? y - 1 : y;
  const fromY = +m[1] > +m[3] ? toY - 1 : toY;
  const p = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { from: p(fromY, +m[1], +m[2]), to: p(toY, +m[3], +m[4]) };
}

// Part of a margin charge (or adjustment) that accrued before the wire: Legacy only.
function preInceptionPart(tx, inception) {
  if (isMarginAdj(tx)) return tx.asOf && tx.asOf < inception ? tx.amount : 0;
  if (!isMarginCharge(tx)) return 0;
  const bp = billingPeriod(tx);
  if (!bp || bp.from >= inception) return 0;
  const total = days(bp.from, bp.to) + 1;
  const pre = Math.min(days(bp.from, inception), total);
  return (tx.amount * pre) / total;
}

/* ============================== main ============================== */
export function computeSplit(p, settings = {}, opts = {}) {
  const S = { ...DEFAULT_SETTINGS, ...settings, flows: { ...(settings.flows || {}) } };
  const A = opts.analytics || computeAnalytics(p);
  const txs = [...(p.transactions || [])].sort((a, b) => a.date.localeCompare(b.date));
  const inception = A.inception.date;
  const start = A.inception.start;
  if (!start || A.inception.value == null) return { available: false, reason: "The account value at inception isn't on file yet. Add the 2/28/2026 statement value on the Upload page." };

  /* ---------- valuation points from inception ---------- */
  const points = [{ date: start, value: A.inception.value, source: A.inception.source || "Inception value", estimated: A.inception.estimated }]
    .concat((A.valuations || []).filter((v) => v.date > start).map((v) => ({ date: v.date, value: v.value, source: v.source })));
  const options = points.slice(1).map((v) => ({ date: v.date, value: r2(v.value), source: v.source }));
  if (!options.length) return { available: false, reason: "No account value after inception is on file yet. Add a month-end statement value on the Upload page." };
  const wanted = opts.asOf || S.asOf || DEFAULT_AS_OF;
  let endIdx = points.map((v) => v.date).lastIndexOf(points.filter((v) => v.date <= wanted).pop()?.date);
  let asOfNote = null;
  if (endIdx < 1) { endIdx = points.length - 1; asOfNote = `No account value is on file for ${wanted}; showing the latest, ${points[endIdx].date}.`; }
  else if (points[endIdx].date !== wanted) asOfNote = `No account value is on file for ${wanted}; showing the nearest earlier one, ${points[endIdx].date}. Add a value for ${wanted} on the Upload page to use it exactly.`;
  const asOf = points[endIdx].date;
  const pts = points.slice(0, endIdx + 1);

  /* ---------- flows, with saved sleeve / use / note ---------- */
  const allFlows = txs.filter(isFlow);
  const keys = flowKeys(allFlows);
  // The wire that funded the strip: the largest wire received within 3 days of inception.
  const wires = allFlows.filter((f) => /Wire/i.test(f.action) && f.amount > 0 && valueDate(f) >= inception && valueDate(f) <= addDays(inception, 3));
  const fundingWire = wires.sort((a, b) => b.amount - a.amount)[0] || null;
  const flows = allFlows.map((f, i) => {
    const saved = S.flows[keys[i]] || {};
    const auto = f === fundingWire ? "main" : "legacy";
    return {
      key: keys[i], date: f.date, valueDate: valueDate(f), action: f.action, description: f.description, amount: r2(f.amount),
      counterparty: counterparty(f),
      sleeve: saved.sleeve in SLEEVES ? saved.sleeve : auto, autoSleeve: auto,
      use: f.amount < 0 ? (saved.use in USES ? saved.use : "personal") : null,
      note: saved.note || "", reviewed: !!saved.reviewed,
      inWindow: valueDate(f) > start && valueDate(f) <= asOf,
    };
  });
  const win = flows.filter((f) => f.inWindow);

  /* ---------- sleeves, period by period ---------- */
  const specificAll = txs.map((x) => ({ x, v: preInceptionPart(x, inception) })).filter((o) => o.v !== 0);
  let L = pts[0].value, M = 0;
  const periods = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], D = Math.max(days(a.date, b.date), 1);
    const inP = (d) => d > a.date && d <= b.date;
    const pf = win.filter((f) => inP(f.valueDate));
    const fL = sum(pf.filter((f) => f.sleeve === "legacy"), (f) => f.amount);
    const fM = sum(pf.filter((f) => f.sleeve === "main"), (f) => f.amount);
    const w = (f) => (f.amount * days(f.valueDate, b.date)) / D;
    const capL = L + sum(pf.filter((f) => f.sleeve === "legacy"), w);
    const capM = M + sum(pf.filter((f) => f.sleeve === "main"), w);
    const gain = b.value - a.value - fL - fM;
    const specific = sum(specificAll.filter((o) => inP(o.x.date)), (o) => o.v);
    const shared = gain - specific;
    const cap = capL + capM;
    const sL = cap > 0 ? capL / cap : (L + M > 0 ? L / (L + M) : 1);
    const gL = shared * sL + specific, gM = shared * (1 - sL);
    periods.push({
      start: a.date, end: b.date, days: D, value: r2(b.value), gain: r2(gain), estimated: !!a.estimated,
      legacy: { begin: r2(L), flows: r2(fL), avgCapital: r2(capL), gain: r2(gL), end: r2(L + fL + gL) },
      main: { begin: r2(M), flows: r2(fM), avgCapital: r2(capM), gain: r2(gM), end: r2(M + fM + gM) },
      shareLegacy: sL, specific: r2(specific),
      ret: cap > 0 ? shared / cap : null,
    });
    L = L + fL + gL; M = M + fM + gM;
  }
  const endValue = pts[pts.length - 1].value;
  const sleeveSum = (k, f) => r2(sum(periods, (x) => x[k][f]));
  const sleeves = {
    legacy: { opening: r2(pts[0].value), flows: sleeveSum("legacy", "flows"), gain: sleeveSum("legacy", "gain"), ending: r2(L), share: endValue ? L / endValue : null },
    main: { opening: 0, flows: sleeveSum("main", "flows"), gain: sleeveSum("main", "gain"), ending: r2(M), share: endValue ? M / endValue : null },
  };
  // Linked return per sleeve (time-weighted, chained by period)
  sleeves.legacy.ret = periods.reduce((g, x) => g * (1 + (x.legacy.avgCapital > 0 ? (x.legacy.gain) / x.legacy.avgCapital : 0)), 1) - 1;
  sleeves.main.ret = periods.reduce((g, x) => g * (1 + (x.main.avgCapital > 0 ? x.main.gain / x.main.avgCapital : 0)), 1) - 1;

  // Cross-check: one Modified Dietz period from inception to the as-of date (no month-end values)
  const D0 = Math.max(days(start, asOf), 1);
  const wOne = (f) => (f.amount * days(f.valueDate, asOf)) / D0;
  const oneL = pts[0].value + sum(win.filter((f) => f.sleeve === "legacy"), wOne);
  const oneM = sum(win.filter((f) => f.sleeve === "main"), wOne);
  const totalGain = endValue - pts[0].value - sum(win, (f) => f.amount);
  const singlePeriod = { shareLegacy: oneL + oneM > 0 ? oneL / (oneL + oneM) : null, totalGain: r2(totalGain) };

  /* ---------- margin tracing ---------- */
  const margin = traceMargin(p, txs, flows, { start, asOf, inception, carriedIn: S.carriedIn in USES ? S.carriedIn : "investment" });

  /* ---------- in-kind split of the latest holdings ---------- */
  const moveKey = S.newAccount === "legacy" ? "legacy" : "main";
  const pos = p.positions || null;
  let transfer = null;
  if (pos && pos.holdings && pos.holdings.length) {
    const pct = sleeves[moveKey].share;
    const rows = pos.holdings.map((h) => {
      const move = Math.floor(h.quantity * pct + 1e-9);
      const price = h.quantity ? h.marketValue / h.quantity : h.price;
      return { symbol: h.symbol, description: h.description, quantity: h.quantity, price: r2(price), marketValue: r2(h.marketValue), move, stay: Math.round((h.quantity - move) * 10000) / 10000, moveValue: r2(move * price) };
    });
    const debit = pos.margin || 0, cash = pos.cash != null ? pos.cash : (pos.net - pos.gross);
    const moveSec = sum(rows, (r) => r.moveValue);
    const moveDebit = debit * pct;
    const target = pos.net * pct;
    transfer = {
      positionsAsOf: pos.asOf, matches: pos.asOf === asOf, sleeve: moveKey, pct, rows,
      gross: r2(pos.gross), net: r2(pos.net), margin: r2(debit), cash: r2(cash),
      moveSecurities: r2(moveSec), moveDebit: r2(moveDebit), moveEquity: r2(moveSec - moveDebit), target: r2(target),
      cashTrueUp: r2(target - (moveSec - moveDebit)),
    };
  }

  /* ---------- checks ---------- */
  const unreviewed = win.filter((f) => !f.reviewed).length;
  const checks = [
    { ok: Math.abs(L + M - endValue) < 0.05, label: "Legacy + 5100 Main equal the account value", detail: `${r2(L + M)} vs ${r2(endValue)}` },
    { ok: L >= 0 && M >= 0, label: "Neither sleeve is negative" },
    { ok: !!fundingWire, label: "Funding wire found", detail: fundingWire ? `${fundingWire.date}, ${r2(fundingWire.amount)}` : `No wire within 3 days of ${inception}; assign the 5100 Main sleeve by hand` },
    { ok: unreviewed === 0, label: "Every deposit and withdrawal reviewed", detail: unreviewed ? `${unreviewed} not yet marked reviewed` : null },
    { ok: !pts[0].estimated, label: "Inception value is from a statement", detail: pts[0].estimated ? pts[0].source : null },
    { ok: margin.available && margin.reconciles !== false, label: "Rebuilt cash balance ties to the positions exports", detail: margin.available ? margin.anchorNote : margin.reason },
  ];

  return {
    available: true, asOf, asOfNote, wanted, options, inception: { date: inception, start, value: r2(pts[0].value), source: pts[0].source, estimated: !!pts[0].estimated },
    endValue: r2(endValue), sleeves, periods, singlePeriod, flows, fundingWire: fundingWire ? { date: fundingWire.date, amount: r2(fundingWire.amount) } : null,
    margin, transfer, checks,
    settings: { version: S.version || 0, asOf: S.asOf, newAccount: moveKey, carriedIn: S.carriedIn, updatedBy: S.updatedBy || null, updatedAt: S.updatedAt || null },
    labels: { sleeves: SLEEVES, uses: USES },
  };
}

/* ============================== margin tracing ============================== */
function traceMargin(p, txs, flows, { start, asOf, inception, carriedIn }) {
  // Cash snapshots: positions exports carry gross and net, so cash = net − gross (negative = margin loan).
  const snaps = (p.positionsHistory || []).map((s) => ({ date: s.asOf, cash: r2(s.net - s.gross) }));
  if (p.positions && !snaps.some((s) => s.date === p.positions.asOf)) snaps.push({ date: p.positions.asOf, cash: r2(p.positions.cash != null ? p.positions.cash : p.positions.net - p.positions.gross) });
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  const usable = snaps.filter((s) => s.date >= start);
  if (!usable.length) return { available: false, reason: "Needs a Positions export dated after inception to rebuild the cash balance." };
  const lastTx = txs.length ? txs[txs.length - 1].date : null;
  // Anchor on the latest snapshot the transactions cover.
  const anchor = [...usable].reverse().find((s) => lastTx && s.date <= lastTx) || usable[usable.length - 1];
  const cashAt = (d) => anchor.cash - sum(txs.filter((x) => x.date > d && x.date <= anchor.date), (x) => x.amount) + sum(txs.filter((x) => x.date > anchor.date && x.date <= d), (x) => x.amount);
  const recon = usable.filter((s) => s.date !== anchor.date && (!lastTx || s.date <= lastTx)).map((s) => ({ date: s.date, statement: s.cash, rebuilt: r2(cashAt(s.date)), diff: r2(cashAt(s.date) - s.cash) }));
  const reconciles = recon.every((r) => Math.abs(r.diff) < 1);

  const flowByTx = new Map();
  const fl = txs.filter(isFlow);
  fl.forEach((x, i) => flowByTx.set(x, flows[i]));

  // Walk the days from inception to the as-of date (and to the end of any billing period charged in the window).
  const charges = txs.filter((x) => (isMarginCharge(x) || isMarginAdj(x)) && x.date > start && x.date <= asOf);
  const bills = charges.filter(isMarginCharge).map((x) => ({ x, bp: billingPeriod(x) })).filter((o) => o.bp);
  const walkEnd = [asOf, ...bills.map((o) => o.bp.to)].sort().pop();
  let cash = cashAt(start);
  const bal = { personal: 0, investment: 0, rental: 0 };
  if (cash < 0) bal[carriedIn] = -cash;
  const carried = r2(Math.max(0, -cash));
  const daily = new Map(); // date -> {personal, investment, rental}
  const byDate = {};
  for (const x of txs) if (x.date > start && x.date <= walkEnd) (byDate[x.date] = byDate[x.date] || []).push(x);
  const drawn = { personal: 0, investment: 0, rental: 0 }, repaid = { personal: 0, investment: 0, rental: 0 };
  for (let d = addDays(start, 1); d <= walkEnd; d = addDays(d, 1)) {
    const today = (byDate[d] || []).slice().sort((a, b) => b.amount - a.amount); // money in before money out
    for (const x of today) {
      const debt0 = Math.max(0, -cash);
      cash += x.amount;
      const debt1 = Math.max(0, -cash);
      if (debt1 > debt0) {
        const add = debt1 - debt0;
        const f = flowByTx.get(x);
        if (f && x.amount < 0) { bal[f.use] += add; drawn[f.use] += add; }
        else if (isMarginCharge(x) || isMarginAdj(x)) {
          const tot = bal.personal + bal.investment + bal.rental;
          for (const k of REPAY_ORDER) { const part = tot > 0 ? add * (bal[k] / tot) : k === "investment" ? add : 0; bal[k] += part; drawn[k] += part; }
        } else { bal.investment += add; drawn.investment += add; }
      } else if (debt1 < debt0) {
        let pay = debt0 - debt1;
        for (const k of REPAY_ORDER) { const r = Math.min(pay, bal[k]); bal[k] -= r; repaid[k] += r; pay -= r; }
        if (pay > 0.005) bal.investment = Math.max(0, bal.investment - pay); // rounding only
      }
    }
    daily.set(d, { ...bal });
  }

  // Interest by use, billing period by billing period.
  const rows = bills.map(({ x, bp }) => {
    const total = days(bp.from, bp.to) + 1;
    const acc = { personal: 0, investment: 0, rental: 0 };
    let inDays = 0;
    for (let d = bp.from; d <= bp.to; d = addDays(d, 1)) {
      const b = d <= start ? null : daily.get(d);
      if (!b) continue;
      inDays++;
      for (const k of REPAY_ORDER) acc[k] += b[k];
    }
    const pre = preInceptionPart(x, inception);
    const rest = x.amount - pre;
    const avgTot = inDays ? (acc.personal + acc.investment + acc.rental) / inDays : 0;
    const split = {};
    for (const k of REPAY_ORDER) split[k] = avgTot > 0 ? r2(rest * (acc[k] / inDays) / avgTot) : (k === "investment" ? r2(rest) : 0);
    return {
      charged: x.date, from: bp.from, to: bp.to, days: total, interest: r2(x.amount), preInception: r2(pre), ...split,
      avgDebit: r2(avgTot), avgPersonal: inDays ? r2(acc.personal / inDays) : 0,
      impliedRate: avgTot > 0 && inDays ? Math.abs(rest) / (avgTot * inDays / 360) : null,
    };
  });
  // Adjustments follow the split of the bill whose period holds their as-of date (else the nearest earlier bill).
  const adjs = charges.filter(isMarginAdj).map((x) => {
    const pre = preInceptionPart(x, inception);
    const ref = valueDate(x);
    const bill = rows.find((r) => ref >= r.from && ref <= r.to) || [...rows].reverse().find((r) => r.to <= ref) || rows[0];
    const rest = x.amount - pre;
    const base = bill ? bill.personal + bill.investment + bill.rental : 0;
    const out = { date: x.date, asOf: x.asOf || null, amount: r2(x.amount), preInception: r2(pre) };
    for (const k of REPAY_ORDER) out[k] = base ? r2(rest * ((bill ? bill[k] : 0) / base)) : (k === "investment" ? r2(rest) : 0);
    return out;
  });
  const totals = { interest: r2(sum(rows, (r) => r.interest) + sum(adjs, (a) => a.amount)), preInception: r2(sum(rows, (r) => r.preInception) + sum(adjs, (a) => a.preInception)) };
  for (const k of REPAY_ORDER) totals[k] = r2(sum(rows, (r) => r[k]) + sum(adjs, (a) => a[k]));
  const end = daily.get(asOf) || bal;
  const endDebt = { personal: r2(end.personal), investment: r2(end.investment), rental: r2(end.rental) };
  return {
    available: true, reconciles, recon,
    anchor: { date: anchor.date, cash: anchor.cash },
    anchorNote: reconciles ? (recon.length ? `Rebuilt from the ${anchor.date} positions export; ties to ${recon.length} other export${recon.length > 1 ? "s" : ""} within $1.` : `Rebuilt from the ${anchor.date} positions export (no second export to tie to yet).`) : `Rebuilt cash differs from a positions export by ${recon.filter((r) => Math.abs(r.diff) >= 1).map((r) => `${r.diff} on ${r.date}`).join(", ")}. Check for missing transactions.`,
    carriedIn: { amount: carried, use: carriedIn },
    startCash: r2(cashAt(start)), endCash: r2(cashAt(asOf)),
    endDebt, drawn: Object.fromEntries(Object.entries(drawn).map(([k, v]) => [k, r2(v)])), repaid: Object.fromEntries(Object.entries(repaid).map(([k, v]) => [k, r2(v)])),
    bills: rows, adjustments: adjs, totals,
    series: [...daily.entries()].filter(([d]) => d <= asOf).filter((_, i, a) => i % 7 === 0 || i === a.length - 1).map(([d, b]) => ({ d, p: r2(b.personal), i: r2(b.investment), r: r2(b.rental) })),
  };
}
