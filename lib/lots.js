// Tax lots for the Schwab account (…965), rebuilt from the transaction history.
//
// Seeding: every Buy opens a lot; shares journaled or transferred in open "estimated" lots (their cost
// isn't in the transaction export). Sells on dates covered by a Schwab Realized Gain/Loss export close
// exactly the lots Schwab reported (same opened date and quantity) and take Schwab's cost and gain.
// Every other sell (before the export's range, or Plaid trades after it) closes lots the way Schwab's
// Tax Lot Optimizer does: short-term losses, long-term losses, no gain or loss, long-term gains,
// short-term gains, the highest-cost lot first within each step. At the latest positions date the
// rebuilt quantities and cost are checked against Schwab's (or Plaid's) holdings; estimated lots take
// whatever cost makes the holding match, and anything that still disagrees is flagged.

const round2 = (n) => Math.round(n * 100) / 100;
const EPS = 1e-6;
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const longTerm = (opened, closed) => !!opened && closed > addDays(opened, 365); // held more than one year

const BUY = new Set(["Buy", "Reinvest Shares"]);
const IN_KIND = new Set(["Journaled Shares", "Security Transfer", "Journal"]);

function tloRank(lot, price, date) {
  const gainPerShare = price - lot.cost / lot.qty;
  const lt = longTerm(lot.opened, date);
  const flat = Math.abs(gainPerShare) < 0.005;
  // 1 ST loss, 2 LT loss, 3 no gain/loss, 4 LT gain, 5 ST gain
  const step = flat ? 3 : gainPerShare < 0 ? (lt ? 2 : 1) : (lt ? 4 : 5);
  return { step, perShare: lot.cost / lot.qty };
}

export function buildLots(p, opts = {}) {
  // Rights distributions arrive without a ticker; borrow it from the matching journal row.
  const all = (p.transactions || []).map((x) => {
    if (x.action !== "Dist Rights Trans" || x.symbol || !x.quantity) return x;
    const j = (p.transactions || []).find((y) => y.symbol && y.action === "Journal" && Math.abs(Math.abs(y.quantity) - x.quantity) < 1e-6 && Math.abs(Date.parse(y.date) - Date.parse(x.date)) <= 3 * 864e5);
    return j ? { ...x, symbol: j.symbol, action: "Journal", price: 0 } : x;
  });
  const txs = all.filter((x) => x.symbol && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x.symbol)).slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order(a) - order(b) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)));
  const fileLots = Object.values(p.realized || {}).flatMap((r) => r.lots.map((l) => ({ ...l, _from: r.from, _to: r.to })));
  const ranges = Object.values(p.realized || {}).map((r) => [r.from, r.to]).filter((r) => r[0] && r[1]);
  const covered = (d) => ranges.some(([a, b]) => d >= a && d <= b);
  const firstDate = txs.length ? txs[0].date : null;

  const open = {};      // symbol -> lots
  const closed = [];    // closed lots, oldest first
  const checks = [];
  let seq = 0;
  const washDates = {}; // symbol -> dates Schwab disallowed a loss (the replacement shares carry it)
  const lotsOf = (s) => (open[s] = open[s] || []);
  const newLot = (s, date, qty, cost, extra = {}) => ({ id: `${s}-${++seq}`, symbol: s, opened: date, qty, cost, estimated: false, source: "Buy", ...extra });

  function take(s, qty, date, price, how, fileLot) {
    // Remove `qty` shares from open lots using the chosen method; returns the pieces taken.
    const lots = lotsOf(s).filter((l) => l.qty > EPS);
    let order;
    if (how === "file") {
      order = lots.filter((l) => l.opened === fileLot.opened).concat(fileLot.opened < (firstDate || "") ? lots.filter((l) => l.estimated && l.opened !== fileLot.opened) : [])
        .concat(lots.filter((l) => l.opened !== fileLot.opened && !(fileLot.opened < (firstDate || "") && l.estimated)).map((l) => ({ l, r: tloRank(l, price, date) })).sort(byTlo).map((x) => x.l));
    } else order = lots.map((l) => ({ l, r: tloRank(l, price, date) })).sort(byTlo).map((x) => x.l);
    const pieces = [];
    let left = qty;
    for (const l of order) {
      if (left <= EPS) break;
      const q = Math.min(l.qty, left);
      const c = l.cost * (q / l.qty);
      pieces.push({ lot: l, qty: q, cost: c });
      l.qty -= q; l.cost -= c; left -= q;
    }
    open[s] = lotsOf(s).filter((l) => l.qty > EPS);
    return { pieces, short: left > EPS ? left : 0 };
  }

  // Group sells by symbol and date so a day's Schwab lots can be matched to that day's trades.
  for (let i = 0; i < txs.length; i++) {
    const x = txs[i];
    const s = x.symbol;
    if (BUY.has(x.action) && x.quantity > 0) {
      lotsOf(s).push(newLot(s, x.date, x.quantity, Math.abs(x.amount) || x.quantity * x.price, { source: x.source === "plaid" ? "Buy (Plaid)" : "Buy" }));
    } else if (IN_KIND.has(x.action) && x.quantity > 0) {
      lotsOf(s).push(newLot(s, x.date, x.quantity, x.quantity * (x.price || 0), { estimated: x.action !== "Journal" || x.price > 0, source: x.action === "Journal" ? "Journaled in" : x.action }));
    } else if (IN_KIND.has(x.action) && x.quantity < 0) {
      take(s, -x.quantity, x.date, x.price || 0, "tlo");
    } else if (x.action === "Reverse Split" || x.action === "Stock Split") {
      // Schwab books a split as shares added under the ticker and old shares removed under the CUSIP.
      const same = txs.filter((y) => y.date === x.date && (y.action === "Reverse Split" || y.action === "Stock Split"));
      const before = lotsOf(s).reduce((a, l) => a + l.qty, 0);
      // Schwab books the full new share count; Plaid books only the change in shares.
      const f = x.source === "plaid" ? (before > EPS ? (before + same.filter((y) => y.symbol === s && y.source === "plaid").reduce((a, y) => a + y.quantity, 0)) / before : 0)
        : (() => { const added = same.filter((y) => y.quantity > 0 && y.symbol === s).reduce((a, y) => a + y.quantity, 0); return added > 0 && before > EPS ? added / before : 0; })();
      if (f > 0 && Math.abs(f - 1) > 1e-9) lotsOf(s).forEach((l) => { l.qty *= f; l.split = (l.split || 1) * f; });
      while (i + 1 < txs.length && txs[i + 1].date === x.date && txs[i + 1].symbol === s && (txs[i + 1].action === x.action)) i++; // one adjustment per symbol and day
    } else if (x.action === "Sell" && x.quantity > 0) {
      // Collect all sells of this symbol today (they're adjacent after sorting).
      let qty = x.quantity, proceeds = x.amount;
      while (i + 1 < txs.length && txs[i + 1].symbol === s && txs[i + 1].date === x.date && txs[i + 1].action === "Sell") { i++; qty += txs[i].quantity; proceeds += txs[i].amount; }
      const price = qty ? proceeds / qty : 0;
      const filed = covered(x.date) ? fileLots.filter((l) => l.symbol === s && l.closed === x.date) : [];
      let left = qty;
      for (const fl of filed) {
        if (left <= EPS) break;
        const q = Math.min(fl.quantity, left);
        const t = take(s, q, x.date, price, "file", fl);
        const lotCost = t.pieces.reduce((a, pc) => a + pc.cost, 0);
        t.pieces.forEach((pc) => { if (pc.lot.estimated && fl.quantity) pc.lot.learnedCost = fl.cost / fl.quantity; });
        closed.push({ symbol: s, opened: fl.opened, closed: x.date, qty: q, proceeds: round2(fl.proceeds * (q / fl.quantity)), cost: round2(fl.cost * (q / fl.quantity)), gain: round2(fl.gain * (q / fl.quantity)),
          term: fl.term === "Long Term" ? "LT" : "ST", wash: !!fl.wash, disallowed: round2((fl.disallowed || 0) * (q / fl.quantity)), method: "Schwab", rebuiltCost: round2(lotCost) });
        if (fl.wash && fl.disallowed > 0) (washDates[s] = washDates[s] || []).push(x.date);
        if (t.short) checks.push({ symbol: s, date: x.date, issue: `Schwab reported a lot opened ${fl.opened} that the rebuilt history can't fully cover (${round2(t.short)} shares short).` });
        left -= q;
      }
      if (left > EPS) {
        const t = take(s, left, x.date, price, "tlo");
        for (const pc of t.pieces) {
          const pr = price * pc.qty;
          closed.push({ symbol: s, opened: pc.lot.opened, closed: x.date, qty: pc.qty, proceeds: round2(pr), cost: round2(pc.cost), gain: round2(pr - pc.cost),
            term: longTerm(pc.lot.opened, x.date) ? "LT" : "ST", wash: false, disallowed: 0, method: "Tax Lot Optimizer", estimated: pc.lot.estimated, source: x.source || "schwab", _lot: { opened: pc.lot.opened, est: pc.lot.estimated, src: pc.lot.source } });
        }
        if (t.short) checks.push({ symbol: s, date: x.date, issue: `Sold ${round2(t.short)} more shares than the history shows were held.` });
      }
    } else if (x.action === "Cancel Sell" && x.quantity > 0) {
      // Schwab books the original sell and then its cancel: put the shares back from the latest rebuilt sale(s).
      let back = x.quantity;
      for (let k = closed.length - 1; k >= 0 && back > EPS; k--) {
        const c = closed[k];
        if (c.symbol !== s || c.method === "Schwab" || c.closed > x.date) continue;
        const q = Math.min(c.qty, back);
        lotsOf(s).push(newLot(s, c.opened, q, c.cost * (q / c.qty), { estimated: !!(c._lot && c._lot.est), source: (c._lot && c._lot.src) || "Cancelled sale" }));
        if (q >= c.qty - EPS) closed.splice(k, 1); else { const f = (c.qty - q) / c.qty; c.qty -= q; c.cost = round2(c.cost * f); c.proceeds = round2(c.proceeds * f); c.gain = round2(c.proceeds - c.cost); }
        back -= q;
      }
    }
  }

  // Check against the latest holdings (Schwab positions export, or the Plaid snapshot).
  const pos = p.positions;
  const holdings = pos ? pos.holdings : [];
  const bySym = {};
  holdings.forEach((h) => { bySym[h.symbol] = h; });
  const syms = new Set([...Object.keys(open).filter((s) => lotsOf(s).some((l) => l.qty > EPS)), ...Object.keys(bySym)]);
  const estimatedSymbols = [];
  const aligned = [];
  for (const s of syms) {
    const h = bySym[s];
    const lots = lotsOf(s);
    const q = lots.reduce((a, l) => a + l.qty, 0);
    if (!h) { if (q > 0.001) checks.push({ symbol: s, issue: `History shows ${round2(q)} shares still held, but the ${pos ? pos.asOf : "latest"} holdings don't include ${s}.` }); continue; }
    if (h.quantity - q > 0.001) {
      lots.push(newLot(s, firstDate, h.quantity - q, 0, { estimated: true, source: "Holding not in the history" }));
      checks.push({ symbol: s, issue: `${round2(h.quantity - q)} shares held aren't in the transaction history; added as an estimated lot.` });
    } else if (q - h.quantity > 0.001) {
      checks.push({ symbol: s, issue: `History shows ${round2(q)} shares, holdings show ${round2(h.quantity)}. Trimmed the newest lots to match.` });
      let extra = q - h.quantity;
      lots.slice().sort((a, b) => (a.opened < b.opened ? 1 : -1)).forEach((l) => { const t = Math.min(l.qty, extra); if (t > 0) { l.cost -= l.cost * (t / l.qty); l.qty -= t; extra -= t; } });
      open[s] = lots.filter((l) => l.qty > EPS);
    }
    const L = lotsOf(s);
    const est = L.filter((l) => l.estimated);
    const known = L.filter((l) => !l.estimated).reduce((a, l) => a + l.cost, 0);
    if (est.length && h.costBasis > 0) {
      const need = h.costBasis - known, eq = est.reduce((a, l) => a + l.qty, 0);
      if (need > 0 && eq > 0) est.forEach((l) => { l.cost = need * (l.qty / eq); });
      else est.forEach((l) => { if (l.learnedCost) l.cost = l.learnedCost * l.qty; });
      estimatedSymbols.push(s);
    }
    let total = L.reduce((a, l) => a + l.cost, 0);
    // Schwab's basis for a holding includes wash-sale losses added to replacement shares. When the share
    // count matches, line the rebuilt lots up with Schwab's basis: the difference goes to lots bought within
    // 30 days of a disallowed loss (or across the holding if none), and those lots are marked adjusted.
    const diff = h.costBasis > 0 ? h.costBasis - total : 0;
    if (Math.abs(diff) > 0.005 && Math.abs(h.quantity - L.reduce((a, l) => a + l.qty, 0)) < 0.001 && Math.abs(diff) <= Math.max(50, h.costBasis * 0.02)) {
      const wd = washDates[s] || [];
      let target = L.filter((l) => !l.estimated && wd.some((d) => l.opened >= addDays(d, -30) && l.opened <= addDays(d, 30)));
      if (!target.length) target = L;
      const tq = target.reduce((a, l) => a + l.qty, 0);
      target.forEach((l) => { const a2 = diff * (l.qty / tq); l.cost += a2; l.basisAdj = (l.basisAdj || 0) + a2; });
      total = h.costBasis;
      aligned.push({ symbol: s, amount: round2(diff) });
    }
    if (h.costBasis > 0 && Math.abs(total - h.costBasis) > Math.max(1, h.costBasis * 0.001))
      checks.push({ symbol: s, issue: `Rebuilt cost basis ${round2(total)} vs ${round2(h.costBasis)} on the ${pos.asOf} holdings. Usually a sale that used specific lots, or a corporate action.`, kind: "cost" });
  }

  // Possible wash sales on rebuilt losses (Schwab's own lots carry Schwab's flag): a buy of the same
  // ticker within 30 days either side, in this account or any other connected account (e.g. the IRA).
  const otherBuys = (opts.otherBuys || []);
  const buys = txs.filter((x) => BUY.has(x.action)).map((x) => ({ symbol: x.symbol, date: x.date, account: "…965" })).concat(otherBuys);
  for (const c of closed) {
    if (c.method === "Schwab" || c.gain >= 0) continue;
    const hit = buys.find((b) => b.symbol === c.symbol && b.date !== c.opened && b.date >= addDays(c.closed, -30) && b.date <= addDays(c.closed, 30));
    if (hit) { c.wash = true; c.washNote = `Bought again ${hit.date}${hit.account && hit.account !== "…965" ? ` in ${hit.account}` : ""}`; }
  }

  const openLots = Object.values(open).flat().filter((l) => l.qty > EPS).map((l) => ({
    id: l.id, symbol: l.symbol, opened: l.opened, qty: Math.round(l.qty * 1e4) / 1e4, cost: round2(l.cost), perShare: l.qty ? Math.round((l.cost / l.qty) * 1e4) / 1e4 : 0,
    estimated: l.estimated, source: l.source, basisAdj: l.basisAdj ? round2(l.basisAdj) : 0, longTermFrom: l.opened ? addDays(l.opened, 366) : null,
  })).sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.opened < b.opened ? -1 : 1));
  const lastFileTo = ranges.reduce((m, r) => (r[1] > m ? r[1] : m), "");
  return {
    method: "Schwab Tax Lot Optimizer (losses first, short-term before long-term; highest cost first)",
    asOf: pos ? pos.asOf : null, firstDate, lastFileTo: lastFileTo || null,
    aligned, openLots, closed: closed.map(({ _lot, ...c }) => c), checks, estimatedSymbols,
    // Rebuilt sales after the last Schwab realized export: these feed the tax plan until Schwab's file covers them.
    afterFile: closed.map(({ _lot, ...c }) => c).filter((c) => c.method !== "Schwab" && (!lastFileTo || c.closed > lastFileTo)),
  };
}

function order(x) { return BUY.has(x.action) || (IN_KIND.has(x.action) && x.quantity > 0) ? 0 : x.action === "Reverse Split" ? 1 : IN_KIND.has(x.action) ? 1.5 : x.action === "Sell" ? 2 : 3; }
function byTlo(a, b) { return a.r.step - b.r.step || b.r.perShare - a.r.perShare || (a.l.opened < b.l.opened ? -1 : 1); }
