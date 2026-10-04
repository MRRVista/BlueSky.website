import { FLOW_ACTIONS, INCOME_ACTIONS, INTEREST_EXPENSE_ACTIONS } from "./schwab.js";

const DAY = 86400000;
const t = (iso) => Date.parse(iso + "T00:00:00Z");
const days = (a, b) => Math.round((t(b) - t(a)) / DAY);
const addDays = (iso, n) => new Date(t(iso) + n * DAY).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);

export const isFlow = (tx) => FLOW_ACTIONS.has(tx.action) && tx.amount !== 0;
export const isIncome = (tx) => tx.action in INCOME_ACTIONS && tx.amount !== 0;
export const isInterest = (tx) => INTEREST_EXPENSE_ACTIONS.has(tx.action);

// Money-weighted return (XIRR). Flows from the investor's view: contributions negative, value received positive.
export function xirr(cashflows) {
  if (cashflows.length < 2) return null;
  const t0 = t(cashflows[0].date);
  const yrs = cashflows.map((c) => (t(c.date) - t0) / (365 * DAY));
  const npv = (r) => cashflows.reduce((a, c, i) => a + c.amount / Math.pow(1 + r, yrs[i]), 0);
  const dnpv = (r) => cashflows.reduce((a, c, i) => a - (yrs[i] * c.amount) / Math.pow(1 + r, yrs[i] + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(r), d = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-10) return next <= -0.9999 ? null : next;
    r = next <= -0.9999 ? -0.9999 : next;
  }
  // Bisection fallback
  let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

export function computeAnalytics(p) {
  const txs = [...(p.transactions || [])].sort((a, b) => a.date.localeCompare(b.date));
  const vals = [...(p.valuations || [])].sort((a, b) => a.date.localeCompare(b.date));
  const allLots = Object.values(p.realized || {}).flatMap((r) => r.lots);
  const flows = txs.filter(isFlow);

  /* ---------- Performance: periods between valuation points ---------- */
  const periods = [];
  for (let i = 1; i < vals.length; i++) {
    const a = vals[i - 1], b = vals[i];
    const inP = (d) => d > a.date && d <= b.date;
    const pf = flows.filter((f) => inP(f.date));
    const D = Math.max(days(a.date, b.date), 1);
    const netFlow = sum(pf, (f) => f.amount);
    const weighted = sum(pf, (f) => (f.amount * days(f.date, b.date)) / D);
    const gain = b.value - a.value - netFlow;
    const denom = a.value + weighted;
    const ret = denom > 0 ? gain / denom : null;
    const income = sum(txs.filter((x) => isIncome(x) && inP(x.date)), (x) => x.amount);
    const interest = sum(txs.filter((x) => isInterest(x) && inP(x.date)), (x) => x.amount);
    const realized = sum(allLots.filter((l) => inP(l.closed)), (l) => l.gain);
    const marketChange = gain - income - interest;
    periods.push({
      start: a.date, end: b.date, days: D, begin: round2(a.value), end_value: round2(b.value),
      deposits: round2(sum(pf.filter((f) => f.amount > 0), (f) => f.amount)),
      withdrawals: round2(sum(pf.filter((f) => f.amount < 0), (f) => f.amount)),
      netFlow: round2(netFlow), gain: round2(gain), income: round2(income), interest: round2(interest),
      marketChange: round2(marketChange), realized: round2(realized), unrealized: round2(marketChange - realized),
      ret, flowHeavy: a.value > 0 && Math.abs(netFlow) > a.value * 0.5,
      endSource: b.source,
    });
  }
  let growth = 1;
  const series = vals.length ? [{ date: vals[0].date, growth: 1 }] : [];
  for (const pr of periods) {
    if (pr.ret != null) growth *= 1 + pr.ret;
    series.push({ date: pr.end, growth });
  }
  const first = vals[0], last = vals[vals.length - 1];
  const totalDays = first && last ? days(first.date, last.date) : 0;
  const twr = growth - 1;
  const twrAnn = totalDays > 0 ? Math.pow(growth, 365 / totalDays) - 1 : null;

  let mwr = null, netContrib = 0, totalGain = 0;
  if (first && last && vals.length > 1) {
    const window = flows.filter((f) => f.date > first.date && f.date <= last.date);
    netContrib = sum(window, (f) => f.amount);
    totalGain = last.value - first.value - netContrib;
    const cf = [{ date: first.date, amount: -first.value }]
      .concat(window.map((f) => ({ date: f.date, amount: -f.amount })))
      .concat([{ date: last.date, amount: last.value }]);
    mwr = xirr(cf);
  }
  // Average capital employed (Modified Dietz over the whole window) — the denominator for "gain on money at work"
  let avgCapital = null;
  if (first && last && totalDays > 0) {
    const window = flows.filter((f) => f.date > first.date && f.date <= last.date);
    avgCapital = first.value + sum(window, (f) => (f.amount * days(f.date, last.date)) / totalDays);
  }

  /* ---------- Income by month and character ---------- */
  const incomeByMonth = {};
  const interestByMonth = {};
  for (const x of txs) {
    const mo = x.date.slice(0, 7);
    if (isIncome(x)) {
      const k = INCOME_ACTIONS[x.action];
      incomeByMonth[mo] = incomeByMonth[mo] || {};
      incomeByMonth[mo][k] = round2((incomeByMonth[mo][k] || 0) + x.amount);
    } else if (isInterest(x)) {
      interestByMonth[mo] = round2((interestByMonth[mo] || 0) + x.amount);
    }
  }
  const incomeBySymbol = {};
  for (const x of txs.filter(isIncome)) {
    const y = x.date.slice(0, 4);
    const key = `${y}|${x.symbol || "(cash)"}`;
    incomeBySymbol[key] = round2((incomeBySymbol[key] || 0) + x.amount);
  }

  /* ---------- Realized gains ---------- */
  const realizedByYear = {};
  for (const [year, r] of Object.entries(p.realized || {})) {
    const lots = r.lots;
    const bySym = {};
    const byMonth = {};
    for (const l of lots) {
      const s = (bySym[l.symbol] = bySym[l.symbol] || { symbol: l.symbol, name: l.name, proceeds: 0, cost: 0, gain: 0, st: 0, lt: 0, lots: 0, washLots: 0, disallowed: 0 });
      s.proceeds += l.proceeds; s.cost += l.cost; s.gain += l.gain; s.st += l.st; s.lt += l.lt; s.lots++;
      if (l.wash) { s.washLots++; s.disallowed += l.disallowed; }
      const mo = l.closed.slice(0, 7);
      const m = (byMonth[mo] = byMonth[mo] || { st: 0, lt: 0, gains: 0, losses: 0 });
      m.st += l.st; m.lt += l.lt;
      if (l.gain >= 0) m.gains += l.gain; else m.losses += l.gain;
    }
    realizedByYear[year] = {
      from: r.from, to: r.to,
      proceeds: round2(sum(lots, (l) => l.proceeds)), cost: round2(sum(lots, (l) => l.cost)),
      gains: round2(sum(lots.filter((l) => l.gain > 0), (l) => l.gain)),
      losses: round2(sum(lots.filter((l) => l.gain < 0), (l) => l.gain)),
      net: round2(sum(lots, (l) => l.gain)), st: round2(sum(lots, (l) => l.st)), lt: round2(sum(lots, (l) => l.lt)),
      lots: lots.length, washLots: lots.filter((l) => l.wash).length,
      disallowed: round2(sum(lots.filter((l) => l.wash), (l) => l.disallowed)),
      bySymbol: Object.values(bySym).map((s) => ({ ...s, proceeds: round2(s.proceeds), cost: round2(s.cost), gain: round2(s.gain), st: round2(s.st), lt: round2(s.lt), disallowed: round2(s.disallowed) })).sort((a, b) => a.gain - b.gain),
      byMonth: Object.entries(byMonth).sort().map(([month, m]) => ({ month, st: round2(m.st), lt: round2(m.lt), gains: round2(m.gains), losses: round2(m.losses) })),
      detail: lots.map((l) => ({ s: l.symbol, c: l.closed, o: l.opened, q: l.quantity, p: l.proceeds, b: l.cost, g: l.gain, t: l.term === "Long Term" ? "LT" : "ST", w: l.wash ? 1 : 0, d: l.disallowed })),
    };
  }

  /* ---------- Current holdings: unrealized, holding period, wash-sale window ---------- */
  const pos = p.positions || null;
  let holdings = [];
  if (pos) {
    const running = {};
    const start = {};
    const lastBuy = {};
    for (const x of txs) {
      if (!x.symbol) continue;
      const q = x.action === "Buy" || x.action === "Journaled Shares" || x.action === "Reinvest Shares" ? x.quantity
        : x.action === "Sell" ? -x.quantity : x.action === "Cancel Sell" ? x.quantity : 0;
      if (!q) continue;
      const before = running[x.symbol] || 0;
      if (before <= 1e-6 && q > 0) start[x.symbol] = x.date;
      running[x.symbol] = before + q;
      if (x.action === "Buy" || x.action === "Reinvest Shares") lastBuy[x.symbol] = x.date;
    }
    holdings = pos.holdings.map((h) => {
      const s = start[h.symbol] || null;
      const lb = lastBuy[h.symbol] || null;
      return {
        ...h,
        positionStart: s,
        longTermFrom: s ? addDays(s, 366) : null,
        lastBuy: lb,
        washSafeFrom: lb ? addDays(lb, 31) : null,
        annualIncome: round2(h.marketValue * (h.yield || 0)),
      };
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    account: pos ? pos.account : "",
    asOf: last ? last.date : null,
    valuations: vals,
    performance: {
      start: first ? first.date : null, end: last ? last.date : null, days: totalDays,
      beginValue: first ? first.value : null, endValue: last ? last.value : null,
      netContributions: round2(netContrib), totalGain: round2(totalGain),
      twr, twrAnnualized: twrAnn, mwr, avgCapital: avgCapital != null ? round2(avgCapital) : null,
      income: round2(sum(periods, (x) => x.income)), interest: round2(sum(periods, (x) => x.interest)),
      marketChange: round2(sum(periods, (x) => x.marketChange)), realized: round2(sum(periods, (x) => x.realized)),
      unrealized: round2(sum(periods, (x) => x.unrealized)),
      periods, series,
    },
    income: {
      byMonth: Object.entries(incomeByMonth).sort().map(([month, v]) => ({ month, ...v, total: round2(sum(Object.values(v))) })),
      interestByMonth: Object.entries(interestByMonth).sort().map(([month, v]) => ({ month, interest: v })),
      bySymbol: Object.entries(incomeBySymbol).map(([k, v]) => { const [year, symbol] = k.split("|"); return { year, symbol, amount: v }; }),
    },
    realized: realizedByYear,
    positions: pos ? { asOf: pos.asOf, gross: round2(pos.gross), margin: round2(pos.margin), net: round2(pos.net), holdings } : null,
    files: p.files || [],
  };
}
