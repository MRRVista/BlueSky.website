// AI Assistant tools. Read tools run immediately; write tools are shown to the user for approval
// and then run through the same API handlers a person uses, so validation, logging and history match.
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { computeAnalytics } from "../analytics.js";
import { readDocs, newId, safeName, DOCS_PATH } from "../docs.js";
import { runScenario } from "./scenario.js";
import { readBytes, copyBlob } from "./blob.js";
import properties from "../handlers/properties.js";
import loans from "../handlers/loans.js";
import notes from "../handlers/notes.js";
import docs, { CATEGORIES as DOC_CATEGORIES } from "../handlers/docs.js";
import upload from "../../api/upload.js";

const r2 = (n) => (n == null || !isFinite(n) ? n : Math.round(n * 100) / 100);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const usd = (n) => (n == null ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// Run one of the site's API handlers in-process as the signed-in user.
function callHandler(handler, req, { method = "POST", query = {}, body } = {}) {
  const fake = { method, headers: { cookie: req.headers.cookie, host: req.headers.host }, query, body };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, status(c) { this.statusCode = c; return this; }, setHeader() {}, writeHead(c) { this.statusCode = c; },
      json(o) { resolve({ status: this.statusCode, data: o }); return this; }, send(t) { resolve({ status: this.statusCode, data: t }); }, end() { resolve({ status: this.statusCode }); },
    };
    Promise.resolve(handler(fake, res)).catch((e) => resolve({ status: 500, data: { error: e.message } }));
  });
}
const ok = (r) => r.status >= 200 && r.status < 300;
const fail = (r) => { throw new Error((r.data && r.data.error) || `Request failed (${r.status}).`); };

/* ---------------- shared data ---------------- */
async function analytics() {
  const p = await readJson(PORTFOLIO_PATH, null);
  if (!p) throw new Error("No account files have been uploaded yet.");
  return { p, A: computeAnalytics(p) };
}

// Current margin rate: the open margin loan on the Loans tab, else implied from recent margin interest.
export async function marginRate(req, A) {
  try {
    const r = await callHandler(loans, req, { method: "GET" });
    if (ok(r)) {
      const row = (r.data.rows || []).find((x) => x.kind === "margin" && x.status === "open" && x.rate != null);
      if (row) return { rate: row.rate, source: "the margin loan on the Loans tab" };
    }
  } catch {}
  if (A && A.positions && A.positions.margin > 0) {
    const end = A.performance.end || today(), cut = new Date(Date.parse(end) - 92 * 864e5).toISOString().slice(0, 10);
    const paid = -A.income.items.filter((x) => x.k === "Margin interest" && x.d > cut).reduce((a, x) => a + x.a, 0);
    if (paid > 0) return { rate: r2((paid / A.positions.margin) * (365 / 92) * 100), source: "margin interest charged over the last 3 months" };
  }
  return { rate: 6, source: "an assumed 6% (no margin rate on file)" };
}

function portfolioSummary(A, mr) {
  const pos = A.positions;
  const est = pos ? pos.holdings.reduce((a, h) => a + (h.annualIncome || 0), 0) : 0;
  const mi = pos ? (pos.margin * mr.rate) / 100 * (365 / 360) : 0;
  return {
    account: A.account, asOf: A.asOf, inception: A.inception,
    positions: pos && {
      asOf: pos.asOf, gross: pos.gross, margin: pos.margin, net: pos.net,
      estimatedAnnualIncomeGross: r2(est), marginRatePct: mr.rate, marginRateSource: mr.source,
      estimatedAnnualMarginInterest: r2(mi), estimatedAnnualIncomeNetOfMarginInterest: r2(est - mi),
      schwabMaintenanceRequirement: r2(pos.holdings.reduce((a, h) => a + (h.marginReq || 0), 0)),
      holdings: pos.holdings.map((h) => ({ symbol: h.symbol, name: h.description, shares: h.quantity, price: h.price, marketValue: h.marketValue, costBasis: h.costBasis,
        unrealized: h.gain, yieldPct: r2((h.yield || 0) * 100), estAnnualIncome: h.annualIncome, marginRequirement: h.marginReq, lastDistribution: h.lastDiv, exDate: h.exDiv, payDate: h.payDate,
        positionStart: h.positionStart, longTermFrom: h.longTermFrom, washSafeFrom: h.washSafeFrom })),
    },
    performanceWindows: (A.performance.windows || []).map((w) => ({ key: w.key, label: w.label, available: w.available, reason: w.reason, from: w.start, to: w.end,
      twr: w.twr, twrAnnualized: w.twrAnnualized, mwr: w.mwr, gain: w.gain, income: w.income, marginInterest: w.interest, realized: w.realized, unrealized: w.unrealized, netDeposits: w.netFlow, estimated: w.estimated })),
    statementPeriods: A.performance.periods.map((x) => ({ from: x.start, to: x.end, begin: x.begin, end: x.end_value, netDeposits: x.netFlow, income: x.income, marginInterest: x.interest, realized: x.realized, unrealized: x.unrealized, gain: x.gain, return: x.ret, estimated: !!x.flowHeavy })),
    valuations: A.valuations,
    incomeByMonth: A.income.byMonth.slice(-15),
    marginInterestByMonth: A.income.interestByMonth.slice(-15),
    realizedByYear: Object.fromEntries(Object.entries(A.realized).map(([y, r]) => [y, { from: r.from, to: r.to, net: r.net, shortTerm: r.st, longTerm: r.lt, gains: r.gains, losses: r.losses, washSaleLots: r.washLots, washSaleDeferred: r.disallowed }])),
    benchmark: A.benchmark.saved || { ...A.benchmark.defaults, note: "default blend (none saved)" },
    filesUploaded: (A.files || []).slice(-10),
  };
}

// Amortization (same math as the Properties tab).
function addMonths(d, n) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + n, Math.min(day, last))).toISOString().slice(0, 10);
}
function mortgageSummary(m) {
  if (!m || !(m.amount > 0) || !(m.amortYears > 0) || !m.firstPaymentDate) return null;
  const n = Math.round(m.amortYears * 12), term = m.termYears ? Math.round(m.termYears * 12) : n, r = (m.rate || 0) / 100 / 12;
  const pmt = m.paymentOverride > 0 ? m.paymentOverride : r === 0 ? m.amount / n : (r * m.amount) / (1 - Math.pow(1 + r, -n));
  let bal = m.amount, balToday = m.amount, made = 0, int12 = 0, prin12 = 0, totalInterest = 0, balloon = 0, lastDate = null;
  const t = today();
  for (let k = 1; k <= term && bal > 0.005; k++) {
    const d = addMonths(m.firstPaymentDate, k - 1), interest = bal * r;
    let principal = Math.min(pmt - interest, bal);
    if (k === term && term < n) balloon = bal - principal;
    bal -= principal + (k === term && term < n ? balloon : 0);
    totalInterest += interest; lastDate = d;
    if (d <= t) { balToday = bal; made = k; } else if (k - made <= 12) { int12 += interest; prin12 += principal; }
  }
  return { monthlyPayment: r2(pmt), payments: term, paymentsMade: made, balanceToday: r2(t < m.loanDate ? 0 : balToday), interestNext12: r2(int12), principalNext12: r2(prin12), balloon: r2(balloon), lastPaymentDate: lastDate, totalInterestOverTerm: r2(totalInterest) };
}

/* ---------------- tool definitions ---------------- */
const SUMMARY = { type: "string", description: "One plain-English sentence describing the change, shown to the user to approve. Name the property/loan and the key numbers." };
const date = { type: "string", description: "YYYY-MM-DD" };

export const TOOLS = [
  // ---- read
  { name: "get_portfolio", description: "Schwab account …965 (the 5100 Main Equity Strip): current holdings with yields, Schwab margin requirements and estimated income; gross/margin/net; estimated annual income gross and net of margin interest; performance by window and by statement period; statement valuations; monthly income and margin interest; realized gains by year; benchmark settings.", input_schema: { type: "object", properties: {} } },
  { name: "get_transactions", description: "Schwab transaction history rows (buys, sells, distributions, margin interest, deposits, wires).", input_schema: { type: "object", properties: { from: date, to: date, symbol: { type: "string" }, action: { type: "string", description: "Filter on action text, e.g. Buy, Sell, Margin Interest, Wire" }, limit: { type: "integer", description: "Max rows, default 200, max 1000" } } } },
  { name: "get_properties", description: "Real estate: 5100 Main and 333 Chestnut — building details, mortgage terms with computed payment and balance, the rent/expense ledger, categories and change log.", input_schema: { type: "object", properties: { property: { type: "string", description: "5100-main or 333-chestnut; omit for all" }, from: date, to: date } } },
  { name: "get_loans", description: "Loans tab: every loan (margin, mortgages, lines) with current rate, balance, payment and annual interest, the Fed Funds rate, and rate-shift scenarios.", input_schema: { type: "object", properties: {} } },
  { name: "get_notes", description: "Discussion Topics and Watch Items lists.", input_schema: { type: "object", properties: {} } },
  { name: "get_documents", description: "Documents library: list of stored files with id, label, category, date, notes.", input_schema: { type: "object", properties: { search: { type: "string" } } } },
  { name: "read_document", description: "Open a stored document from the Documents library to read it (PDF, image, CSV or text).", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "get_market_prices", description: "Daily or monthly price history and the latest price for US-listed tickers (ETFs, stocks, indexes like SPY). close is the traded price; adjusted_close includes distributions.", input_schema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" }, description: "Up to 6 tickers" }, from: date, to: date, interval: { type: "string", enum: ["daily", "monthly"] } }, required: ["symbols"] } },
  { name: "run_scenario", description: "Stress test the margined account from today's positions: market falls by decline_pct over months (gradual or immediate), optional recovery. Monthly path of gross value, margin loan, equity, Schwab maintenance requirement, income and margin interest, the first month of any margin call, and the one-time decline that would trigger a call. Use for 'what if the market falls X% over Y months' questions. Covered-call income funds often fall less than the market; set downside_capture (e.g. 0.8) when the user wants that assumption, and say so.", input_schema: { type: "object", properties: {
    decline_pct: { type: "number", description: "Market decline in percent, e.g. 20. Negative for a rise." }, months: { type: "integer", description: "Months over which it falls" },
    shape: { type: "string", enum: ["gradual", "immediate"] }, recover_months: { type: "integer", description: "Months to recover back to today's level after the bottom; 0 = no recovery" },
    horizon_months: { type: "integer", description: "Total months to project (default months + recover_months)" },
    downside_capture: { type: "number", description: "Fund move per 1% market move, default 1.0" }, capture_by_symbol: { type: "object", description: "Per-ticker override, e.g. {\"QQQI\":0.85}" },
    income_change_pct: { type: "number", description: "Change to distribution yields, e.g. -20 for a 20% cut. Default 0 (distributions scale with fund value)." },
    income_use: { type: "string", enum: ["reduces_margin", "withdrawn", "reinvested"], description: "What happens to distributions; default reduces_margin (cash stays in the account)" },
    margin_rate_pct: { type: "number", description: "Default: the account's current margin rate" }, maintenance_pct: { type: "number", description: "Override Schwab's per-fund requirement with one percent for all funds" },
    monthly_withdrawal: { type: "number", description: "Cash taken out each month (added to the margin loan)" } } } },

  // ---- write (user approves each)
  { name: "update_property", description: "Change a property's data, exactly as the Properties tab does. ops: setBuilding {building}, setMortgage {mortgage}, clearMortgage, addEntries {entries[], mode add|replace, replaceCategories[]}, updateEntry {id, entry}, deleteEntries {ids[]}, restoreEntries {ids[]}, addCategory {name, type}. Expenses are positive amounts; Rent is income. setBuilding and setMortgage replace the whole record, so include every existing field you want to keep (read get_properties first).", input_schema: { type: "object", properties: {
    summary: SUMMARY, op: { type: "string", enum: ["setBuilding", "setMortgage", "clearMortgage", "addEntries", "updateEntry", "deleteEntries", "restoreEntries", "addCategory"] },
    property: { type: "string", description: "5100-main or 333-chestnut" },
    building: { type: "object", properties: { address: { type: "string" }, purchaseDate: date, purchasePrice: { type: "number" }, currentValue: { type: "number" }, valueAsOf: date, squareFeet: { type: "number" }, units: { type: "number" }, notes: { type: "string" } } },
    mortgage: { type: "object", properties: { lender: { type: "string" }, amount: { type: "number" }, loanDate: date, firstPaymentDate: date, rate: { type: "number", description: "percent" }, amortYears: { type: "number" }, termYears: { type: "number", description: "balloon term; omit if fully amortizing" }, paymentOverride: { type: "number" }, notes: { type: "string" } } },
    entries: { type: "array", items: { type: "object", properties: { date, category: { type: "string" }, amount: { type: "number" }, description: { type: "string" } }, required: ["date", "category", "amount"] } },
    mode: { type: "string", enum: ["add", "replace"] }, replaceCategories: { type: "array", items: { type: "string" } },
    id: { type: "string" }, ids: { type: "array", items: { type: "string" } }, entry: { type: "object" },
    name: { type: "string", description: "addCategory: name" }, type: { type: "string", enum: ["income", "expense"] } }, required: ["summary", "op"] } },
  { name: "update_loans", description: "Change the Loans tab. ops: add {loan}, update {id, loan}, balance {id, value, asOf} (value null clears), close {id, date, note}, reopen {id}, delete {id}, fedOverride {upper, lower} (upper null clears). loan fields: name, lender, kind (amortizing|margin|interest-only|line), rateType (fixed|floating), fixedRate, spread (over Fed Funds upper), originalPrincipal, amortMonths, firstPaymentDate, maturityDate, openedDate, escrowMonthly, paymentOverride, autoBalance (margin: use the Schwab balance), notes.", input_schema: { type: "object", properties: {
    summary: SUMMARY, op: { type: "string", enum: ["add", "update", "balance", "close", "reopen", "delete", "fedOverride"] }, id: { type: "string" }, loan: { type: "object" },
    value: { type: ["number", "null"] }, asOf: date, date, note: { type: "string" }, upper: { type: ["number", "null"] }, lower: { type: "number" } }, required: ["summary", "op"] } },
  { name: "update_notes", description: "Change Discussion Topics (board discussion) or Watch Items (board watch). ops: add {item or items[]}, update {id, item}, delete {id}, restore {id}, move {id, dir up|down}. item fields: section, title, body, response, source, owner, status, note.", input_schema: { type: "object", properties: {
    summary: SUMMARY, op: { type: "string", enum: ["add", "update", "delete", "restore", "move"] }, board: { type: "string", enum: ["discussion", "watch"] },
    id: { type: "string" }, item: { type: "object" }, items: { type: "array", items: { type: "object" } }, dir: { type: "string", enum: ["up", "down"] } }, required: ["summary", "op"] } },
  { name: "set_statement_value", description: "Record (or remove) a month-end account value from a Schwab statement (total account value, net of margin). This is what performance is measured between.", input_schema: { type: "object", properties: { summary: SUMMARY, date, value: { type: "number" }, remove: { type: "boolean" }, source_file: { type: "string", description: "Attachment name the value came from, if any" } }, required: ["summary", "date"] } },
  { name: "set_benchmark", description: "Save the benchmark blend for everyone (Performance tab).", input_schema: { type: "object", properties: { summary: SUMMARY, components: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, weight: { type: "number" } }, required: ["symbol", "weight"] }, description: "Up to 6 US tickers, weights total 100" }, leverage: { type: "number", description: "1 = none, max 3" }, borrowRate: { type: "number", description: "percent" } }, required: ["summary", "components"] } },
  { name: "update_document", description: "Edit a Documents entry's label, category, date or notes, or delete it.", input_schema: { type: "object", properties: { summary: SUMMARY, op: { type: "string", enum: ["update", "delete"] }, id: { type: "string" }, label: { type: "string" }, category: { type: "string", enum: DOC_CATEGORIES }, docDate: date, notes: { type: "string" } }, required: ["summary", "op", "id"] } },
  { name: "save_attachment_to_documents", description: "File a file the user attached in this chat into the Documents library.", input_schema: { type: "object", properties: { summary: SUMMARY, file_name: { type: "string", description: "Attachment name exactly as shown" }, label: { type: "string" }, category: { type: "string", enum: DOC_CATEGORIES }, docDate: date, notes: { type: "string" } }, required: ["summary", "file_name", "category"] } },
  { name: "import_schwab_export", description: "Import an attached Schwab CSV export (Transactions, Positions, Realized Gain/Loss, Investment Income or Balances) exactly like the Upload page.", input_schema: { type: "object", properties: { summary: SUMMARY, file_name: { type: "string" } }, required: ["summary", "file_name"] } },
];

export const WRITE_TOOLS = new Set(["update_property", "update_loans", "update_notes", "set_statement_value", "set_benchmark", "update_document", "save_attachment_to_documents", "import_schwab_export"]);
export const TOOL_LABELS = {
  get_portfolio: "Read the account", get_transactions: "Read transactions", get_properties: "Read property data", get_loans: "Read loans", get_notes: "Read notes",
  get_documents: "Looked in Documents", read_document: "Read a document", get_market_prices: "Looked up market prices", run_scenario: "Ran a scenario",
  update_property: "Property change", update_loans: "Loan change", update_notes: "Notes change", set_statement_value: "Statement value", set_benchmark: "Benchmark blend",
  update_document: "Document change", save_attachment_to_documents: "File to Documents", import_schwab_export: "Import Schwab export",
};
// Which cached views to refresh in the browser after a write.
const CHANGES = { update_property: "properties", update_loans: "loans", update_notes: "notes", set_statement_value: "portfolio", set_benchmark: "portfolio", update_document: "docs", save_attachment_to_documents: "docs", import_schwab_export: "portfolio" };

/* ---------------- execution ---------------- */
// Returns { content, changed? } where content is a string or Anthropic content blocks.
export async function runTool(name, input, ctx) {
  const { req, conv } = ctx;
  const json = (o) => JSON.stringify(o);
  switch (name) {
    case "get_portfolio": {
      const { A } = await analytics();
      return { content: json(portfolioSummary(A, await marginRate(req, A))) };
    }
    case "get_transactions": {
      const p = await readJson(PORTFOLIO_PATH, null);
      if (!p) throw new Error("No transactions uploaded.");
      const lim = Math.min(Math.max(Number(input.limit) || 200, 1), 1000);
      const act = input.action ? String(input.action).toLowerCase() : null;
      const rows = p.transactions.filter((x) => (!input.from || x.date >= input.from) && (!input.to || x.date <= input.to) && (!input.symbol || x.symbol === String(input.symbol).toUpperCase()) && (!act || String(x.action).toLowerCase().includes(act)));
      return { content: json({ matching: rows.length, shown: Math.min(lim, rows.length), rows: rows.slice(0, lim) }) };
    }
    case "get_properties": {
      const r = await callHandler(properties, req, { method: "GET" });
      if (!ok(r)) fail(r);
      const d = r.data;
      const out = { categories: d.categories, properties: {} };
      for (const id of d.order || Object.keys(d.properties)) {
        if (input.property && input.property !== id) continue;
        const p = d.properties[id];
        const entries = p.entries.filter((e) => (!input.from || e.date >= input.from) && (!input.to || e.date <= input.to));
        out.properties[id] = { name: p.name, status: p.status, building: p.building, mortgage: p.mortgage, mortgageComputed: mortgageSummary(p.mortgage),
          entryCount: entries.length, entries: entries.slice(-600).map((e) => ({ id: e.id, date: e.date, category: e.category, amount: e.amount, description: e.description, source: e.source })),
          recentlyDeleted: (p.trash || []).slice(0, 50).map((e) => ({ id: e.id, date: e.date, category: e.category, amount: e.amount })), log: (p.log || []).slice(0, 20) };
      }
      return { content: json(out) };
    }
    case "get_loans": {
      const r = await callHandler(loans, req, { method: "GET" });
      if (!ok(r)) fail(r);
      return { content: json(r.data) };
    }
    case "get_notes": {
      const r = await callHandler(notes, req, { method: "GET" });
      if (!ok(r)) fail(r);
      return { content: json({ discussion: r.data.discussion, watch: r.data.watch }) };
    }
    case "get_documents": {
      const idx = await readDocs();
      const q = input.search ? String(input.search).toLowerCase() : null;
      const list = idx.docs.filter((d) => !q || `${d.label} ${d.filename} ${d.notes} ${d.category}`.toLowerCase().includes(q));
      return { content: json({ count: list.length, categories: DOC_CATEGORIES, docs: list.slice(-300).map((d) => ({ id: d.id, label: d.label, filename: d.filename, category: d.category, docDate: d.docDate, notes: d.notes, contentType: d.contentType, size: d.size, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt })) }) };
    }
    case "read_document": {
      const idx = await readDocs();
      const d = idx.docs.find((x) => x.id === input.id);
      if (!d) throw new Error("Document not found.");
      return { content: await documentBlocks(d.pathname, d.contentType, d.filename) };
    }
    case "get_market_prices": return { content: json(await prices(input)) };
    case "run_scenario": {
      const { A } = await analytics();
      const mr = await marginRate(req, A);
      return { content: json(runScenario(input, { positions: A.positions, marginRate: mr.rate, marginRateSource: mr.source })) };
    }

    // ---- writes
    case "update_property": {
      const { summary, ...b } = input;
      const r = await callHandler(properties, req, { body: b });
      if (!ok(r)) fail(r);
      const p = b.property && r.data.properties[b.property];
      return { content: json({ ok: true, saved: p ? { building: p.building, mortgage: p.mortgage, mortgageComputed: mortgageSummary(p.mortgage), entryCount: p.entries.length, lastLog: (p.log || [])[0] } : { categories: r.data.categories } }), changed: CHANGES[name] };
    }
    case "update_loans": {
      const { summary, ...b } = input;
      const r = await callHandler(loans, req, { body: b });
      if (!ok(r)) fail(r);
      return { content: json({ ok: true, loans: r.data.loans.map((l) => ({ id: l.id, name: l.name, status: l.status })), totals: r.data.totals }), changed: CHANGES[name] };
    }
    case "update_notes": {
      const { summary, ...b } = input;
      const r = await callHandler(notes, req, { body: b });
      if (!ok(r)) fail(r);
      return { content: json({ ok: true, discussion: r.data.discussion.length, watch: r.data.watch.length }), changed: CHANGES[name] };
    }
    case "set_statement_value": {
      const body = input.remove ? { removeValuation: input.date } : { valuation: { date: input.date, value: input.value, from: input.source_file ? "pdf" : undefined, file: input.source_file ? `${input.source_file}, via AI Assistant` : undefined } };
      const r = await callHandler(upload, req, { body });
      if (!ok(r)) fail(r);
      return { content: json(r.data), changed: CHANGES[name] };
    }
    case "set_benchmark": {
      const r = await callHandler(upload, req, { body: { benchmark: { components: input.components, leverage: input.leverage ?? 1, borrowRate: input.borrowRate ?? 0 } } });
      if (!ok(r)) fail(r);
      return { content: json(r.data), changed: CHANGES[name] };
    }
    case "update_document": {
      const { summary, ...b } = input;
      const r = await callHandler(docs, req, { body: b });
      if (!ok(r)) fail(r);
      return { content: json({ ok: true }), changed: CHANGES[name] };
    }
    case "save_attachment_to_documents": {
      const f = findAttachment(conv, input.file_name);
      const id = newId(), pathname = `docs/${id}/${safeName(f.name)}`;
      await copyBlob(f.path, pathname, f.originalType || f.mediaType);
      const idx = await readDocs();
      idx.docs.push({ id, pathname, filename: f.name, label: String(input.label || f.name.replace(/\.[^.]+$/, "")).slice(0, 200), category: DOC_CATEGORIES.includes(input.category) ? input.category : "Other",
        docDate: /^\d{4}-\d{2}-\d{2}$/.test(input.docDate || "") ? input.docDate : null, notes: String(input.notes || "Filed by AI Assistant.").slice(0, 4000),
        size: f.size || null, contentType: f.originalType || f.mediaType, uploadedBy: req.session.email, uploadedAt: new Date().toISOString() });
      await writeJson(DOCS_PATH, idx);
      return { content: json({ ok: true, id }), changed: CHANGES[name] };
    }
    case "import_schwab_export": {
      const f = findAttachment(conv, input.file_name);
      const text = f.text != null && /csv/i.test(f.name) ? f.text : (await readBytes(f.path)).bytes.toString("utf8");
      const r = await callHandler(upload, req, { body: { files: [{ name: f.name, text }] } });
      if (!ok(r)) fail(r);
      return { content: json(r.data), changed: CHANGES[name] };
    }
    default: throw new Error(`Unknown tool ${name}.`);
  }
}

function findAttachment(conv, name) {
  const files = conv.files || [];
  const f = files.find((x) => x.name === name) || files.find((x) => x.name.toLowerCase() === String(name || "").toLowerCase());
  if (!f) throw new Error(`No attachment named "${name}" in this chat. Attachments: ${files.map((x) => x.name).join(", ") || "none"}.`);
  return f;
}

// Content blocks for a stored file, for the model to read.
export async function documentBlocks(pathname, contentType, filename) {
  const { bytes } = await readBytes(pathname);
  const ct = String(contentType || "").toLowerCase(), name = String(filename || "");
  if (ct.includes("pdf") || /\.pdf$/i.test(name)) {
    if (bytes.length > 30 * 1024 * 1024) throw new Error("That PDF is over 30 MB, too large to read.");
    return [{ type: "text", text: `Document: ${name}` }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") }, title: name.slice(0, 200) }];
  }
  const img = ct.match(/image\/(png|jpe?g|gif|webp)/);
  if (img || /\.(png|jpe?g|gif|webp)$/i.test(name)) {
    if (bytes.length > 5 * 1024 * 1024) throw new Error("That image is over 5 MB; attach it in the chat instead so it can be resized.");
    const mt = img ? `image/${img[1] === "jpg" ? "jpeg" : img[1]}` : `image/${name.split(".").pop().toLowerCase().replace("jpg", "jpeg")}`;
    return [{ type: "text", text: `Image: ${name}` }, { type: "image", source: { type: "base64", media_type: mt, data: bytes.toString("base64") } }];
  }
  if (/text|csv|json|xml|markdown/.test(ct) || /\.(csv|txt|md|json|xml|tsv)$/i.test(name)) {
    const t = bytes.toString("utf8");
    return [{ type: "text", text: `File: ${name}\n\n${t.slice(0, 200000)}${t.length > 200000 ? "\n[truncated]" : ""}` }];
  }
  throw new Error(`Can't read ${name} here (${contentType || "unknown type"}). Download it and attach it in the chat; Word, Excel and PowerPoint files are read there.`);
}

/* ---------------- market data ---------------- */
async function prices(input) {
  const token = process.env.EODHD_API_TOKEN;
  if (!token) throw new Error("Market data isn't connected (EODHD_API_TOKEN not set).");
  const syms = (input.symbols || []).slice(0, 6).map((s) => String(s).toUpperCase().replace(/[^A-Z0-9.\-]/g, "")).filter(Boolean);
  if (!syms.length) throw new Error("Give at least one ticker.");
  const to = input.to || today(), from = input.from || new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const monthly = input.interval === "monthly" || (Date.parse(to) - Date.parse(from)) / 864e5 > 400;
  const out = {};
  for (const s of syms) {
    const code = s.includes(".") ? s : `${s}.US`;
    try {
      const r = await fetch(`https://eodhd.com/api/eod/${encodeURIComponent(code)}?from=${from}&to=${to}&period=${monthly ? "m" : "d"}&fmt=json&api_token=${token}`);
      if (!r.ok) throw new Error(`no data (${r.status})`);
      const rows = (await r.json()).map((x) => ({ date: x.date, close: x.close, adjusted_close: x.adjusted_close }));
      const step = Math.ceil(rows.length / 400);
      let latest = null;
      try { const q = await fetch(`https://eodhd.com/api/real-time/${encodeURIComponent(code)}?fmt=json&api_token=${token}`); if (q.ok) { const j = await q.json(); latest = { price: j.close, change_p: j.change_p, timestamp: j.timestamp ? new Date(j.timestamp * 1000).toISOString() : null }; } } catch {}
      out[s] = { interval: monthly ? "monthly" : "daily", points: rows.length, rows: rows.filter((_, i) => i % step === 0 || i === rows.length - 1), latest };
    } catch (e) { out[s] = { error: e.message }; }
  }
  return out;
}

/* ---------------- approval text ---------------- */
// Key/value lines shown under each pending change so the user sees exactly what will be saved.
export function changeDetails(name, input) {
  const lines = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== "") lines.push([k, typeof v === "number" ? (/(amount|price|value|payment|principal|escrow)/i.test(k) ? usd(v) : String(v)) : typeof v === "object" ? JSON.stringify(v) : String(v)]); };
  const { summary, ...rest } = input || {};
  if (name === "update_property" && rest.entries) {
    add("Property", rest.property); add("Action", rest.op); add("Mode", rest.mode);
    add("Entries", rest.entries.length);
    rest.entries.slice(0, 40).forEach((e) => lines.push([e.date, `${e.category} ${usd(e.amount)}${e.description ? ` · ${e.description}` : ""}`]));
    if (rest.entries.length > 40) lines.push(["…", `${rest.entries.length - 40} more`]);
    return lines;
  }
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
    else add(k, v);
  }
  return lines;
}
