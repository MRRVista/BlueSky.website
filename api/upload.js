import { getSession, readJson as readBody, sameOrigin } from "../lib/auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../lib/store.js";
import { validateBenchmark } from "../lib/benchmarks.js";
import { put } from "@vercel/blob";
import { detectType, parseTransactions, parseRealized, parsePositions, parseIncome, parseBalances } from "../lib/schwab.js";
import { readDocs, newId, safeName, DOCS_PATH } from "../lib/docs.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// A new Transactions export replaces every stored row in the date range it covers.
// Rows outside that range (older history) are kept, so a year-to-date export never erases prior years.
function replaceTransactions(oldTx, newTx) {
  if (!newTx.length) return { list: oldTx, from: null, to: null, removed: 0 };
  const dates = newTx.map((x) => x.date).sort();
  const from = dates[0], to = dates[dates.length - 1];
  const kept = oldTx.filter((x) => x.date < from || x.date > to);
  return { list: kept.concat(newTx).sort((a, b) => b.date.localeCompare(a.date)), from, to, removed: oldTx.length - kept.length };
}

// Schwab-covered date ranges; Plaid rows only fill dates outside them.
function mergeRanges(list) {
  const out = [];
  list.slice().sort((a, b) => a.from.localeCompare(b.from)).forEach((r) => {
    const last = out[out.length - 1];
    if (last && r.from <= new Date(Date.parse(last.to) + 864e5).toISOString().slice(0, 10)) { if (r.to > last.to) last.to = r.to; } else out.push({ ...r });
  });
  return out;
}

const TYPE_LABEL = { transactions: "Transactions", positions: "Positions", realized: "Realized Gain/Loss", income: "Investment Income", balances: "Balances" };

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
    const lastOf = (t) => { const f = [...p.files].reverse().find((x) => x.type === t); return f ? { name: f.name, uploadedAt: f.uploadedAt, by: f.by } : null; };
    return res.status(200).json({ onFile: { transactions: lastOf("transactions"), positions: lastOf("positions"), realized: lastOf("realized"), income: lastOf("income"), balances: lastOf("balances") }, files: p.files.slice(-40).reverse(), valuations: p.valuations, transactions: p.transactions.length, positionsAsOf: p.positions && p.positions.asOf, realizedYears: Object.keys(p.realized) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const body = await readBody(req);
  const results = [];
  const archived = [];
  const now = new Date().toISOString();

  for (const f of Array.isArray(body.files) ? body.files : []) {
    const name = String(f.name || "file.csv").slice(0, 200);
    const text = String(f.text || "");
    const type = detectType(text);
    try {
      if (type === "transactions") {
        const tx = parseTransactions(text);
        if (!Array.isArray(p.txRanges)) {
          // First upload since ranges were tracked: everything already on file counts as covered.
          const d = p.transactions.filter((x) => x.source !== "plaid").map((x) => x.date).sort();
          p.txRanges = d.length ? [{ from: d[0], to: d[d.length - 1] }] : [];
        }
        const r = replaceTransactions(p.transactions, tx);
        p.transactions = r.list;
        if (r.from) p.txRanges = mergeRanges(p.txRanges.concat([{ from: r.from, to: r.to }]));
        results.push({ name, type, ok: true, message: r.from ? `${tx.length} transactions from ${r.from} to ${r.to} now replace the ${r.removed} stored for those dates. Earlier history is kept (${p.transactions.length} in total).` : "No transaction rows found in this file." });
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
      } else if (type === "balances") {
        const b = parseBalances(text);
        p.balances = b;
        if (b.asOf && b.value) {
          upsertValuation(p, { date: b.asOf, value: b.value, source: "Schwab balances export" });
          results.push({ name, type, ok: true, message: `Account value ${b.value.toLocaleString("en-US", { style: "currency", currency: "USD" })} on ${b.asOf} added as a valuation point.` });
        } else {
          results.push({ name, type, ok: true, message: "Balances saved. No clearly labeled account value was found, so no valuation point was added; use Add a statement value instead." });
        }
      } else {
        results.push({ name, type: null, ok: false, message: "Not recognized. Upload Schwab Transactions, Positions, Realized Gain/Loss (lot details) or Investment Income CSV exports." });
        continue;
      }
      p.files.push({ name, type, uploadedAt: now, by: session.email });
      archived.push({ name, type, text });
    } catch (err) {
      console.error("upload parse failed", name, err);
      results.push({ name, type, ok: false, message: "The file couldn't be read. Export it again from Schwab as CSV and retry." });
    }
  }

  // Month-end statement value entered by hand (the number on page 1 of the Schwab statement)
  if (body.valuation && body.valuation.date && Number.isFinite(Number(body.valuation.value))) {
    const d = String(body.valuation.date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const file = String(body.valuation.file || "").slice(0, 160);
      const source = body.valuation.from === "pdf" ? `Statement PDF (${file}), confirmed by ${session.email}`
        : body.valuation.from === "pdf-begin" ? `Statement PDF beginning value (${file}), confirmed by ${session.email}`
        : "Manual entry (statement value) by " + session.email;
      upsertValuation(p, { date: d, value: Number(body.valuation.value), source });
      results.push({ name: "Valuation", type: "valuation", ok: true, message: `Account value for ${d} saved.` });
    }
  }
  if (body.removeValuation) {
    const d = String(body.removeValuation);
    p.valuations = p.valuations.filter((x) => x.date !== d);
    results.push({ name: "Valuation", type: "valuation", ok: true, message: `Valuation for ${d} removed.` });
  }

  // Benchmark proxy blend, shared by everyone who signs in
  if (body.benchmark) {
    try {
      const cfg = validateBenchmark(body.benchmark);
      p.settings = { ...(p.settings || {}), benchmark: { ...cfg, savedBy: session.email, savedAt: now } };
      results.push({ name: "Benchmark", type: "benchmark", ok: true, message: "Benchmark blend saved." });
    } catch (err) {
      return res.status(400).json({ error: err.message, results });
    }
  }

  // Keep every original export permanently in the document repository ("Schwab exports").
  if (archived.length) {
    try {
      const idx = await readDocs();
      for (const a of archived) {
        const id = newId();
        const pathname = `docs/${id}/${safeName(a.name)}`;
        const blob = await put(pathname, a.text, { access: "private", addRandomSuffix: false, contentType: "text/csv" });
        idx.docs.push({ id, pathname, filename: a.name, label: `${TYPE_LABEL[a.type] || "Schwab"} export, ${now.slice(0, 10)}`, category: "Schwab exports",
          docDate: now.slice(0, 10), notes: "Saved automatically when uploaded.", size: Buffer.byteLength(a.text), contentType: blob.contentType || "text/csv", uploadedBy: session.email, uploadedAt: now, system: true });
      }
      await writeJson(DOCS_PATH, idx);
    } catch (err) {
      console.error("archive failed", err);
      results.push({ name: "Archive", type: null, ok: false, message: "The data was saved, but the original files couldn't be archived to Documents." });
    }
  }

  try {
    await writeJson(PORTFOLIO_PATH, p);
  } catch (err) {
    console.error("save failed", err);
    return res.status(500).json({ error: "The files were read but couldn't be saved. Try again in a minute.", results });
  }
  return res.status(200).json({ ok: true, results });
}
