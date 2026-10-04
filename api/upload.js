import { getSession, readJson as readBody, sameOrigin } from "../lib/auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../lib/store.js";
import { detectType, parseTransactions, parseRealized, parsePositions, parseIncome } from "../lib/schwab.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const txKey = (x) => [x.date, x.action, x.symbol, x.quantity, x.price, x.fees, x.amount, x.description].join("|");

// Merge transaction exports that overlap: for each identical row, keep the larger of the two counts.
function mergeTransactions(oldTx, newTx) {
  const count = (list) => list.reduce((m, x) => m.set(txKey(x), (m.get(txKey(x)) || 0) + 1), new Map());
  const oldC = count(oldTx), newC = count(newTx);
  const out = [...oldTx];
  for (const [k, n] of newC) {
    const extra = n - (oldC.get(k) || 0);
    if (extra > 0) out.push(...newTx.filter((x) => txKey(x) === k).slice(0, extra));
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function upsertValuation(p, v) {
  const existing = p.valuations.find((x) => x.date === v.date);
  if (existing && /Statement/.test(existing.source) && !/Statement|Manual/.test(v.source)) return; // statements win over position snapshots
  p.valuations = p.valuations.filter((x) => x.date !== v.date).concat([v]).sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to upload files." });

  const p = (await readJson(PORTFOLIO_PATH)) || { transactions: [], realized: {}, positions: null, positionsHistory: [], valuations: [], files: [] };

  if (req.method === "GET") {
    return res.status(200).json({ files: p.files.slice(-40).reverse(), valuations: p.valuations, transactions: p.transactions.length, positionsAsOf: p.positions && p.positions.asOf, realizedYears: Object.keys(p.realized) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const body = await readBody(req);
  const results = [];
  const now = new Date().toISOString();

  for (const f of Array.isArray(body.files) ? body.files : []) {
    const name = String(f.name || "file.csv").slice(0, 200);
    const text = String(f.text || "");
    const type = detectType(text);
    try {
      if (type === "transactions") {
        const tx = parseTransactions(text);
        const before = p.transactions.length;
        p.transactions = mergeTransactions(p.transactions, tx);
        results.push({ name, type, ok: true, message: `${tx.length} rows read; ${p.transactions.length - before} new transactions added.` });
      } else if (type === "realized") {
        const r = parseRealized(text);
        p.realized[r.year] = r;
        results.push({ name, type, ok: true, message: `${r.lots.length} closed lots for ${r.year} (replaces any earlier ${r.year} file).` });
      } else if (type === "positions") {
        const pos = parsePositions(text);
        if (!p.positions || pos.asOf >= p.positions.asOf) p.positions = pos;
        p.positionsHistory = (p.positionsHistory || []).filter((x) => x.asOf !== pos.asOf).concat([{ asOf: pos.asOf, gross: pos.gross, margin: pos.margin, net: pos.net }]);
        upsertValuation(p, { date: pos.asOf, value: pos.net, source: "Schwab positions export" });
        results.push({ name, type, ok: true, message: `${pos.holdings.length} holdings as of ${pos.asOf}; net value ${pos.net.toLocaleString("en-US", { style: "currency", currency: "USD" })} added as a valuation point.` });
      } else if (type === "income") {
        const inc = parseIncome(text);
        p.investmentIncome = inc;
        results.push({ name, type, ok: !inc.empty, message: inc.empty ? "This export has no rows. In Schwab, set the date range to start 1/1 of the year and export again." : `${inc.rows.length} rows stored.` });
      } else {
        results.push({ name, type: null, ok: false, message: "Not recognized. Upload Schwab Transactions, Positions, Realized Gain/Loss (lot details) or Investment Income CSV exports." });
        continue;
      }
      p.files.push({ name, type, uploadedAt: now, by: session.email });
    } catch (err) {
      console.error("upload parse failed", name, err);
      results.push({ name, type, ok: false, message: "The file couldn't be read. Export it again from Schwab as CSV and retry." });
    }
  }

  // Month-end statement value entered by hand (the number on page 1 of the Schwab statement)
  if (body.valuation && body.valuation.date && Number.isFinite(Number(body.valuation.value))) {
    const d = String(body.valuation.date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      upsertValuation(p, { date: d, value: Number(body.valuation.value), source: "Manual entry (statement value) by " + session.email });
      results.push({ name: "Valuation", type: "valuation", ok: true, message: `Account value for ${d} saved.` });
    }
  }
  if (body.removeValuation) {
    const d = String(body.removeValuation);
    p.valuations = p.valuations.filter((x) => x.date !== d);
    results.push({ name: "Valuation", type: "valuation", ok: true, message: `Valuation for ${d} removed.` });
  }

  try {
    await writeJson(PORTFOLIO_PATH, p);
  } catch (err) {
    console.error("save failed", err);
    return res.status(500).json({ error: "The files were read but couldn't be saved. Try again in a minute.", results });
  }
  return res.status(200).json({ ok: true, results });
}
