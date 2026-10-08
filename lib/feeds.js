// Plaid data flowing into the rest of the site:
//  - the Schwab account (…965): investment transactions become Schwab-style rows (performance, income,
//    margin tracing, account split, tax lots all read them), and Plaid holdings become a positions
//    snapshot enriched with EODHD dividend data. Schwab uploads always win for the dates they cover.
//  - property ledgers: see propfeed.js.
import { readJson, writeJson, PORTFOLIO_PATH } from "./store.js";
import { dividendInfo } from "./eod.js";
import { isoToday } from "./plaidcore.js";

const round2 = (n) => Math.round(n * 100) / 100;

// Plaid investment subtype -> Schwab action, so every existing calculation treats it the same way.
const ACTION = {
  buy: "Buy", "buy to cover": "Buy", "dividend reinvestment": "Reinvest Shares", "interest reinvestment": "Reinvest Shares", "long-term capital gain reinvestment": "Reinvest Shares", "short-term capital gain reinvestment": "Reinvest Shares",
  sell: "Sell", "sell short": "Sell",
  dividend: "Cash Dividend", "qualified dividend": "Qualified Dividend", "non-qualified dividend": "Non-Qualified Div",
  interest: "Credit Interest", "interest receivable": "Credit Interest", "margin expense": "Margin Interest",
  "long-term capital gain": "Long Term Cap Gain", "short-term capital gain": "Short Term Cap Gain", "return of capital": "Return Of Capital",
  deposit: "MoneyLink Transfer", contribution: "MoneyLink Transfer", withdrawal: "MoneyLink Transfer", distribution: "MoneyLink Transfer", transfer: "Journal",
  "account fee": "Service Fee", "management fee": "Service Fee", "fund fee": "Service Fee", "legal fee": "Service Fee", "miscellaneous fee": "Service Fee", "trust fee": "Service Fee", "transfer fee": "Service Fee",
  "tax withheld": "Tax Withheld", tax: "Tax Withheld", "non-resident tax": "Tax Withheld", "cash in lieu": "Cash In Lieu", split: "Stock Split", "stock distribution": "Stock Split",
};

export function plaidToSchwab(t) {
  // Shares moving in or out keep their sign (in opens a lot, out closes one); so do splits.
  const shareMove = t.type === "transfer" && t.sym && Number(t.qty);
  const action = shareMove ? "Security Transfer" : ACTION[t.sub] || (t.type === "buy" ? "Buy" : t.type === "sell" ? "Sell" : t.type === "fee" ? "Service Fee" : t.type === "transfer" ? "Journal" : "Other");
  const signed = action === "Security Transfer" || action === "Stock Split";
  const qty = signed ? Number(t.qty) || 0 : Math.abs(Number(t.qty) || 0);
  return { date: t.date, action, symbol: t.sym || "", description: t.name || t.secName || "", quantity: qty, price: Number(t.price) || 0,
    fees: Number(t.fees) || 0, amount: round2(-(Number(t.amount) || 0)), source: "plaid", pid: t.id };
}

// Dates Schwab exports already cover (Plaid rows are added only outside them).
function coveredRanges(p) {
  if (Array.isArray(p.txRanges) && p.txRanges.length) return p.txRanges;
  const d = (p.transactions || []).filter((x) => x.source !== "plaid").map((x) => x.date).sort();
  return d.length ? [{ from: d[0], to: d[d.length - 1] }] : [];
}

// The …965 account in Plaid: the one tagged to the Schwab account row, else the Schwab brokerage ending 0965.
export function portfolioAccount(store, balance) {
  const accts = (store.items || []).flatMap((it) => (it.accounts || []).map((a) => ({ ...a, itemId: it.itemId })));
  const tagged = balance && balance.rows && balance.rows["sys:portfolio"] && balance.rows["sys:portfolio"].plaidAccountId;
  return accts.find((a) => a.id === tagged) || accts.find((a) => a.type === "investment" && a.mask === "0965") || null;
}

export async function feedPortfolio(store, archive, balance) {
  const acct = portfolioAccount(store, balance);
  if (!acct) return { skipped: "no Plaid account for …965" };
  const p = await readJson(PORTFOLIO_PATH, null);
  if (!p) return { skipped: "no portfolio file" };
  const ranges = coveredRanges(p);
  const inRange = (d) => ranges.some((r) => d >= r.from && d <= r.to);
  const schwab = (p.transactions || []).filter((x) => x.source !== "plaid");
  const lastCovered = ranges.reduce((m, r) => (r.to > m ? r.to : m), "");
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * 864e5;
  const rows = Object.values(archive.txns).filter((x) => x.kind === "inv" && x.acct === acct.id && !x.removed && !inRange(x.date)).map(plaidToSchwab)
    // the same event dated a day or two apart by Plaid and Schwab, just past the export's last date
    .filter((r) => !(lastCovered && near(r.date, lastCovered) && schwab.some((x) => near(x.date, r.date) && x.action === r.action && (x.symbol || "") === (r.symbol || "") && Math.abs(x.amount - r.amount) < 0.02)));
  const sig = (list) => list.map((x) => JSON.stringify([x.pid, x.date, x.action, x.symbol, x.quantity, x.amount])).sort().join("|");
  const before = sig((p.transactions || []).filter((x) => x.source === "plaid"));
  const after = sig(rows);
  let changed = false;
  if (before !== after) {
    p.transactions = (p.transactions || []).filter((x) => x.source !== "plaid").concat(rows).sort((a, b) => b.date.localeCompare(a.date));
    changed = true;
  }
  const today = isoToday();
  let snapshot = null;
  // Holdings snapshot, only when it's newer than the latest positions on file.
  if (acct.holdings && acct.holdings.length && (!p.positions || p.positions.asOf < today)) {
    const hs = acct.holdings.filter((h) => h.type !== "cash" && h.symbol !== "CASH");
    const divs = await dividendInfo(hs.map((h) => h.symbol)).catch(() => ({}));
    const holdings = hs.map((h) => {
      const d = divs[h.symbol] || {};
      const price = Number(h.price) || (h.quantity ? h.value / h.quantity : 0);
      return { symbol: h.symbol, description: h.name || h.symbol, marketValue: round2(h.value), yield: d.annual && price ? d.annual / price : 0, quantity: h.quantity, price,
        costBasis: round2(h.costBasis || 0), gain: round2(h.value - (h.costBasis || 0)), lastDiv: d.lastDiv || 0, exDiv: d.exDiv || null, payDate: d.payDate || null, marginReq: 0, assetType: h.assetType };
    });
    const gross = holdings.reduce((a, h) => a + h.marketValue, 0);
    const net = acct.current != null ? acct.current : gross;
    const cash = round2(net - gross);
    snapshot = { asOf: today, account: `Plaid …${acct.mask}`, holdings, cash, gross: round2(gross), margin: cash < 0 ? -cash : 0, net: round2(net), source: "plaid" };
    p.positions = snapshot;
    p.positionsHistory = (p.positionsHistory || []).filter((x) => x.asOf !== today).concat([{ asOf: today, gross: snapshot.gross, margin: snapshot.margin, net: snapshot.net, source: "plaid" }]);
    changed = true;
  }
  // Daily account value from Plaid (statements and Schwab exports win on their dates).
  if (acct.current != null) {
    const v = p.valuations || [];
    const ex = v.find((x) => x.date === today);
    if (!ex || /Plaid/.test(ex.source)) {
      p.valuations = v.filter((x) => x.date !== today).concat([{ date: today, value: round2(acct.current), source: "Plaid balance" }]).sort((a, b) => a.date.localeCompare(b.date));
      changed = true;
    }
  }
  if (changed) await writeJson(PORTFOLIO_PATH, p);
  return { rows: rows.length, snapshot: !!snapshot, account: acct.mask };
}

// Buys in other connected investment accounts (the IRA, Roths…) for the wash-sale check.
export function otherBuys(archive, portfolioAcctId, accountsById) {
  return Object.values(archive.txns || {}).filter((x) => x.kind === "inv" && x.acct !== portfolioAcctId && x.type === "buy" && x.sym && !x.removed)
    .map((x) => ({ symbol: x.sym, date: x.date, account: accountsById[x.acct] ? `${accountsById[x.acct].shortName || accountsById[x.acct].name} …${accountsById[x.acct].mask}` : "another account" }));
}
