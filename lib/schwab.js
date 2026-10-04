import { parseCsv, money, isoDate } from "./csv.js";

// Classify Schwab transaction actions.
export const FLOW_ACTIONS = new Set(["MoneyLink Transfer", "Wire Received", "Wire Sent", "Wire Funds", "Journal", "Security Transfer", "Funds Received", "MoneyLink Deposit", "MoneyLink Adj"]);
export const INCOME_ACTIONS = {
  "Cash Dividend": "Cash dividend (character set on 1099)",
  "Non-Qualified Div": "Non-qualified dividend",
  "Qualified Dividend": "Qualified dividend",
  "Pr Yr Cash Div": "Cash dividend (character set on 1099)",
  "Pr Yr Non-Qual Div": "Non-qualified dividend",
  "Substitute Inc Pmt": "Substitute payment in lieu",
  "Schwab Sub Inc Cr": "Substitute payment in lieu",
  "Credit Interest": "Interest",
  "Bond Interest": "Interest",
  "Return Of Capital": "Return of capital",
  "Long Term Cap Gain": "Capital gain distribution",
  "Short Term Cap Gain": "Capital gain distribution",
  "Cash In Lieu": "Cash in lieu",
};
export const INTEREST_EXPENSE_ACTIONS = new Set(["Margin Interest", "Margin Interest Adj"]);

// Identify a Schwab export from its header cells alone (no AI, no file names).
// Works for CSVs straight from Schwab and for Excel files converted to CSV in the browser.
export function detectType(text) {
  const rows = parseCsv(String(text).slice(0, 4000)).slice(0, 6).map((r) => r.map((c) => String(c || "").trim()));
  const first = (rows[0] && rows[0][0]) || "";
  const hasRow = (...labels) => rows.some((r) => labels.every((l) => r.some((c) => c.toLowerCase().startsWith(l.toLowerCase()))));
  if (/^Investment Income/i.test(first)) return "income";
  if (/^Realized Gain\/Loss/i.test(first) || hasRow("Symbol", "Closed Date", "Opened Date", "Proceeds")) return "realized";
  if (/^Positions for account/i.test(first) || hasRow("Symbol", "Mkt Val", "Cost Basis")) return "positions";
  if (/^Balances for account/i.test(first)) return "balances";
  if (hasRow("Date", "Action", "Symbol", "Description", "Amount")) return "transactions";
  return null;
}

// Schwab Balances export: keep the raw rows; take the account value if the row is clearly labeled.
export function parseBalances(text) {
  const rows = parseCsv(text).map((r) => r.map((c) => String(c || "").trim()));
  const title = (rows[0] && rows[0][0]) || "";
  const m = title.match(/(\d{4})\/(\d{2})\/(\d{2})/) || title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  let asOf = null;
  if (m) asOf = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  let value = null;
  for (const r of rows) {
    if (/^(Total )?Account Value/i.test(r[0] || "")) {
      const v = r.slice(1).map(money).find((n) => n !== 0);
      if (v) { value = v; break; }
    }
  }
  return { asOf, value, rows: rows.slice(0, 200) };
}

export function parseTransactions(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => r[0] === "Date" && r[1] === "Action");
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = isoDate(r[0]);
    if (!date) continue;
    out.push({
      date,
      action: (r[1] || "").trim(),
      symbol: (r[2] || "").trim(),
      description: (r[3] || "").trim(),
      quantity: money(r[4]),
      price: money(r[5]),
      fees: money(r[6]),
      amount: money(r[7]),
    });
  }
  return out;
}

export function parseRealized(text) {
  const rows = parseCsv(text);
  const title = (rows[0] && rows[0][0]) || "";
  const range = title.match(/from (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})/);
  const from = range ? isoDate(range[1]) : null;
  const to = range ? isoDate(range[2]) : null;
  const hi = rows.findIndex((r) => r[0] === "Symbol" && r[2] === "Closed Date");
  const lots = [];
  for (const r of rows.slice(hi + 1)) {
    const closed = isoDate(r[2]);
    if (!r[0] || !closed) continue;
    lots.push({
      symbol: r[0].trim(),
      name: (r[1] || "").trim(),
      closed,
      opened: isoDate(r[3]),
      quantity: money(r[4]),
      proceeds: money(r[7]),
      cost: money(r[8]),
      gain: money(r[9]),
      lt: money(r[11]),
      st: money(r[12]),
      term: (r[13] || "").trim(),
      wash: /yes/i.test(r[15] || ""),
      disallowed: money(r[16]),
    });
  }
  const year = (to || from || "").slice(0, 4) || String(new Date().getFullYear());
  return { year, from, to, lots };
}

export function parsePositions(text) {
  const rows = parseCsv(text);
  const title = (rows[0] && rows[0][0]) || "";
  const m = title.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  const asOf = m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
  const account = (title.match(/account (.*?) as of/) || [])[1] || "";
  const hi = rows.findIndex((r) => r[0] === "Symbol");
  const header = rows[hi] || [];
  const col = (label) => header.findIndex((h) => h.startsWith(label));
  const c = {
    desc: col("Description"), mv: col("Mkt Val"), yld: col("Div Yld"), qty: col("Qty"), price: col("Price"),
    pct: col("% of Acct"), cost: col("Cost Basis"), gain: col("Gain $"), gainPct: col("Gain %"),
    lastDiv: col("Last Div"), exDiv: col("Ex-Div"), payDate: col("Div Pay Date"), marginReq: col("Margin Req"), type: col("Asset Type"),
  };
  const holdings = [];
  let cash = 0, net = 0;
  for (const r of rows.slice(hi + 1)) {
    const sym = (r[0] || "").trim();
    if (!sym) continue;
    if (/^Cash/i.test(sym)) { cash = money(r[c.mv]); continue; }
    if (/^(Positions|Account) Total/i.test(sym)) { net = money(r[c.mv]); continue; }
    holdings.push({
      symbol: sym, description: r[c.desc], marketValue: money(r[c.mv]), yield: money(r[c.yld]) / 100,
      quantity: money(r[c.qty]), price: money(r[c.price]), costBasis: money(r[c.cost]), gain: money(r[c.gain]),
      lastDiv: money(r[c.lastDiv]), exDiv: isoDate(r[c.exDiv]), payDate: isoDate(r[c.payDate]),
      marginReq: money(r[c.marginReq]), assetType: r[c.type],
    });
  }
  const gross = holdings.reduce((a, h) => a + h.marketValue, 0);
  if (!net) net = gross + cash;
  return { asOf, account, holdings, cash, gross, margin: cash < 0 ? -cash : 0, net };
}

export function parseIncome(text) {
  const rows = parseCsv(text);
  if (/no investment income/i.test(String(text))) return { rows: [], empty: true };
  return { rows: rows.slice(1).filter((r) => r.some((v) => v && v.trim())), empty: false };
}
