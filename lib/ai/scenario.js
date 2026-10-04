// Market stress scenarios for the margined income-ETF account.
// Each month: prices move along the chosen path (scaled by each fund's downside capture),
// distributions arrive at each fund's current yield on its current value, margin interest accrues,
// and the equity ratio is checked against the maintenance requirement.

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

// Market level (1 = today) at the end of month m: falls to (1 - drop) by month `months`
// (all at once in month 1 if immediate), then recovers evenly over `recover` months if given.
function pathLevel(shape, drop, months, recover, m) {
  if (m <= 0) return 1;
  if (m <= months) return shape === "immediate" ? 1 - drop : 1 - (drop * m) / months;
  if (recover > 0) return 1 - drop + Math.min((m - months) / recover, 1) * drop;
  return 1 - drop;
}

export function runScenario(input, ctx) {
  const pos = ctx.positions;
  if (!pos || !pos.holdings || !pos.holdings.length) throw new Error("No positions on file. Upload a Schwab positions export first.");
  const drop = Math.max(-0.9, Math.min(0.95, Number(input.decline_pct ?? 20) / 100));
  const months = Math.max(1, Math.min(60, Math.round(Number(input.months ?? 6))));
  const shape = input.shape === "immediate" ? "immediate" : "gradual";
  const recover = Math.max(0, Math.min(60, Math.round(Number(input.recover_months ?? 0)) || 0));
  const horizon = Math.max(months + recover, Math.min(120, Math.round(Number(input.horizon_months ?? 0)) || 0));
  const captureAll = Number.isFinite(Number(input.downside_capture)) ? Number(input.downside_capture) : 1;
  const captureBy = input.capture_by_symbol && typeof input.capture_by_symbol === "object" ? input.capture_by_symbol : {};
  const incomeScale = Number.isFinite(Number(input.income_change_pct)) ? 1 + Number(input.income_change_pct) / 100 : 1;
  const incomeUse = ["reduces_margin", "withdrawn", "reinvested"].includes(input.income_use) ? input.income_use : "reduces_margin";
  const rate = Number.isFinite(Number(input.margin_rate_pct)) ? Number(input.margin_rate_pct) : ctx.marginRate ?? 6;
  // Maintenance requirement: Schwab's per-position requirement from the positions export unless one is given.
  const maintGiven = Number.isFinite(Number(input.maintenance_pct)) ? Number(input.maintenance_pct) / 100 : null;
  const withdraw = Number(input.monthly_withdrawal ?? 0) || 0;

  let loan = pos.margin;
  const lots = pos.holdings.map((h) => ({ symbol: h.symbol, start: h.marketValue, value: h.marketValue, shares: h.quantity, yield: h.yield || 0,
    capture: Number.isFinite(Number(captureBy[h.symbol])) ? Number(captureBy[h.symbol]) : captureAll,
    req: maintGiven != null ? maintGiven : h.marginReq > 0 && h.marketValue > 0 ? h.marginReq / h.marketValue : 0.3 }));
  const gross0 = lots.reduce((a, l) => a + l.value, 0);
  const reqOf = () => lots.reduce((a, l) => a + l.value * l.req, 0);
  const maint = reqOf() / gross0; // blended requirement today
  const snap = (m, level, income, interest) => {
    const gross = lots.reduce((a, l) => a + l.value, 0), equity = gross - loan, need = reqOf();
    return { month: m, market: r4(level), gross: r2(gross), margin: r2(loan), equity: r2(equity), equityPct: r4(equity / gross), requirement: r2(need), excess: r2(equity - need), income: r2(income), interest: r2(interest), call: equity < need };
  };
  const rows = [snap(0, 1, 0, 0)];
  let firstCall = rows[0].call ? 0 : null, totIncome = 0, totInterest = 0, totWithdrawn = 0, minPct = rows[0].equityPct;
  let prevLevel = 1;
  for (let m = 1; m <= horizon; m++) {
    const level = pathLevel(shape, drop, months, recover, m);
    const mkt = level / prevLevel - 1;
    prevLevel = level;
    let income = 0;
    for (const l of lots) {
      l.value *= 1 + mkt * l.capture;
      income += (l.value * l.yield * incomeScale) / 12;
    }
    const interest = (loan * rate) / 100 / 360 * (365 / 12);
    loan += interest;
    if (incomeUse === "reduces_margin") loan -= income;
    else if (incomeUse === "reinvested") { const g = lots.reduce((a, l) => a + l.value, 0); lots.forEach((l) => (l.value += (income * l.value) / g)); }
    else totWithdrawn += income;
    if (withdraw) { loan += withdraw; totWithdrawn += withdraw; }
    totIncome += income; totInterest += interest;
    const row = snap(m, level, income, interest);
    if (row.call && firstCall == null) firstCall = m;
    minPct = Math.min(minPct, row.equityPct);
    rows.push(row);
  }
  // One-time market drop from today's positions that would push equity below the requirement.
  const callDrop = (reqFn) => {
    let lo = 0, hi = 1;
    const short = (d) => { let g = 0, need = 0; for (const l of lots) { const v = l.start * Math.max(0, 1 - d * l.capture); g += v; need += v * reqFn(l); } return g - pos.margin < need; };
    if (short(0)) return 0;
    if (!short(1)) return null;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (short(mid)) hi = mid; else lo = mid; }
    return r4(hi);
  };
  const end = rows[rows.length - 1];
  return {
    assumptions: { decline_pct: drop * 100, months, shape, recover_months: recover, horizon_months: horizon, downside_capture: captureAll, capture_by_symbol: captureBy,
      income_change_pct: r2((incomeScale - 1) * 100), income_use: incomeUse, margin_rate_pct: rate, margin_rate_source: Number.isFinite(Number(input.margin_rate_pct)) ? "given" : ctx.marginRateSource,
      maintenance: maintGiven != null ? `${maintGiven * 100}% for every fund (given)` : `Schwab's per-fund requirement from the positions export, ${r2(maint * 100)}% blended today`, monthly_withdrawal: withdraw, positions_as_of: pos.asOf },
    start: rows[0],
    end: { ...end, equityChange: r2(end.equity - rows[0].equity), equityChangePct: r4(end.equity / rows[0].equity - 1) },
    totals: { income: r2(totIncome), marginInterest: r2(totInterest), withdrawn: r2(totWithdrawn) },
    lowestEquityPct: r4(minPct),
    firstMarginCallMonth: firstCall,
    instantDropToMarginCall: {
      schwabRequirement: callDrop((l) => l.req), "at 30%": callDrop(() => 0.3), "at 40%": callDrop(() => 0.4), "at 50%": callDrop(() => 0.5),
    },
    note: "instantDropToMarginCall: the one-time market decline from today that would trigger a maintenance call, with each fund moving by the market decline times its downside capture. null means no call even at a 100% decline.",
    months: rows,
  };
}
