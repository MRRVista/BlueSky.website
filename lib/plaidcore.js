// Plaid: one connection flow for every account type, and the sync that keeps a permanent
// transaction archive. Access tokens are AES-256-GCM encrypted at rest and never leave the server.
import crypto from "node:crypto";
import { readJson, writeJson } from "./store.js";

export const PLAID_PATH = "data/plaid.json";
export const ARCHIVE_PATH = "data/archive/transactions.json";
export const HISTORY_DAYS = 730; // Plaid's maximum (24 months)

const CLIENT_ID = () => process.env.PLAID_CLIENT_ID || "6a65f8716a37c0000d33c424";
const BASE = () => `https://${process.env.PLAID_ENV === "sandbox" ? "sandbox" : "production"}.plaid.com`;
export const configured = () => !!process.env.PLAID_SECRET;
const keyBytes = () => crypto.createHash("sha256").update(process.env.PLAID_TOKEN_KEY || `${process.env.SESSION_SECRET || ""}|bluesky-plaid`).digest();
const isoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function open(sealed) {
  const [iv, tag, enc] = sealed.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
export async function plaid(route, body) {
  const r = await fetch(BASE() + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID(), secret: process.env.PLAID_SECRET, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_message || j.display_message || `Plaid ${r.status}`); e.code = j.error_code; e.type = j.error_type; throw e; }
  return j;
}

export const readStore = async () => (await readJson(PLAID_PATH, null)) || { items: [] };
export const readArchive = async () => (await readJson(ARCHIVE_PATH, null)) || { version: 0, txns: {}, cursors: {}, invFrom: {} };

// One link token for every institution: Transactions is required (nearly every bank, card issuer and
// brokerage supports it); Investments and Liabilities come along wherever the institution offers them.
export function linkTokenBody(email, { accessToken } = {}) {
  const body = { client_name: "Blue Sky Investment Group", user: { client_user_id: crypto.createHash("sha256").update(email).digest("hex").slice(0, 32) },
    country_codes: ["US"], language: "en" };
  if (accessToken) body.access_token = accessToken; // update mode: fix a sign-in, no new products
  else {
    body.products = ["transactions"];
    body.required_if_supported_products = ["investments", "liabilities"];
    body.transactions = { days_requested: HISTORY_DAYS };
  }
  if (process.env.PLAID_REDIRECT_URI) body.redirect_uri = process.env.PLAID_REDIRECT_URI;
  return body;
}

// Products an item can be asked for. Items linked before the single button only consented to one.
export function productsOf(it) {
  if (Array.isArray(it.products) && it.products.length) return it.products;
  return it.kind === "brokerage" ? ["investments"] : ["transactions"];
}
const NEEDS_CONSENT = new Set(["ADDITIONAL_CONSENT_REQUIRED", "PRODUCTS_NOT_SUPPORTED", "INVALID_PRODUCT", "PRODUCT_NOT_ENABLED", "NO_INVESTMENT_ACCOUNTS", "NO_LIABILITY_ACCOUNTS", "NO_INVESTMENT_AUTH_ACCOUNTS"]);
const LOGIN = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "INVALID_CREDENTIALS", "ITEM_LOCKED", "USER_SETUP_REQUIRED", "MFA_NOT_SUPPORTED", "ACCESS_NOT_GRANTED", "INSUFFICIENT_CREDENTIALS"]);

/* ---------------- normalizers ---------------- */
const SEC_TYPE = { etf: "ETFs & Closed End Funds", "mutual fund": "Mutual Funds", equity: "Equities", "fixed income": "Fixed Income", cash: "Cash and Money Market", derivative: "Options", cryptocurrency: "Crypto" };
function normAccount(x) {
  return { id: x.account_id, name: x.official_name || x.name, shortName: x.name, mask: x.mask, type: x.type, subtype: x.subtype,
    current: x.balances.current, available: x.balances.available, limit: x.balances.limit, currency: x.balances.iso_currency_code };
}
function normLiability(kind, l) {
  if (kind === "mortgage") return { kind, rate: l.interest_rate && l.interest_rate.percentage, rateType: l.interest_rate && l.interest_rate.type, nextPayment: l.next_monthly_payment, nextDue: l.next_payment_due_date,
    lastPayment: l.last_payment_amount, lastPaid: l.last_payment_date, originationAmount: l.origination_principal_amount, originationDate: l.origination_date, maturity: l.maturity_date,
    term: l.loan_term, loanType: l.loan_type_description, escrowBalance: l.escrow_balance, ytdInterest: l.ytd_interest_paid, ytdPrincipal: l.ytd_principal_paid, pastDue: l.past_due_amount,
    address: l.property_address ? [l.property_address.street, l.property_address.city, l.property_address.region].filter(Boolean).join(", ") : null };
  if (kind === "credit") {
    const apr = (l.aprs || []).find((a) => a.apr_type === "purchase_apr") || (l.aprs || [])[0];
    return { kind, rate: apr && apr.apr_percentage, minPayment: l.minimum_payment_amount, nextDue: l.next_payment_due_date, lastPayment: l.last_payment_amount, lastPaid: l.last_payment_date,
      statementBalance: l.last_statement_balance, statementDate: l.last_statement_issue_date, overdue: l.is_overdue };
  }
  return { kind, rate: l.interest_rate_percentage, minPayment: l.minimum_payment_amount, nextDue: l.next_payment_due_date, lastPayment: l.last_payment_amount, lastPaid: l.last_payment_date,
    originationAmount: l.origination_principal_amount, originationDate: l.origination_date, maturity: l.expected_payoff_date, ytdInterest: l.ytd_interest_paid, ytdPrincipal: l.ytd_principal_paid };
}
function normBank(t, itemId) {
  const pfc = t.personal_finance_category || {};
  const cp = (t.counterparties || [])[0];
  return { id: t.transaction_id, item: itemId, acct: t.account_id, kind: "bank", date: t.date, auth: t.authorized_date || null, name: t.name || t.merchant_name || "", merchant: t.merchant_name || (cp && cp.name) || null,
    amount: t.amount, pending: !!t.pending, pendingId: t.pending_transaction_id || null, pfc: pfc.primary || null, pfcd: pfc.detailed || null, chan: t.payment_channel || null, check: t.check_number || null };
}
function normInv(t, sec, itemId) {
  const s = sec[t.security_id] || {};
  return { id: t.investment_transaction_id, item: itemId, acct: t.account_id, kind: "inv", date: t.date, name: t.name || "", amount: t.amount, qty: t.quantity, price: t.price, fees: t.fees || 0,
    type: t.type, sub: t.subtype, sym: s.ticker_symbol || null, secName: s.name || null, secType: s.type || null, cusip: s.cusip || null };
}

/* ---------------- sync one item ---------------- */
// Refreshes accounts, holdings, liabilities and every transaction into the archive. `live` asks
// Plaid for real-time balances (a billed call); the daily sync uses the balances Plaid already has.
export async function syncItem(it, archive, { live = false } = {}) {
  const token = open(it.token);
  const products = productsOf(it);
  const notes = [];
  it.error = null; it.errorCode = null; it.needsLogin = false;
  // Which products the item actually carries (items linked through the single button carry several).
  try {
    const g = await plaid("/item/get", { access_token: token });
    const pr = new Set([...(g.item.products || []), ...(g.item.consented_products || [])]);
    if (pr.size) it.products = [...pr].filter((p) => ["transactions", "investments", "liabilities", "auth", "balance"].includes(p));
    if (g.item.institution_id) it.institutionId = g.item.institution_id;
  } catch (e) { if (LOGIN.has(e.code)) return loginNeeded(it, e); }
  const has = (p) => (it.products || products).includes(p);

  let acc;
  try {
    acc = live ? await plaid("/accounts/balance/get", { access_token: token }).catch(() => plaid("/accounts/get", { access_token: token })) : await plaid("/accounts/get", { access_token: token });
  } catch (e) { if (LOGIN.has(e.code)) return loginNeeded(it, e); throw e; }
  const accounts = acc.accounts.map(normAccount);
  const kinds = new Set(accounts.map((a) => a.type));
  const missing = [];

  // Holdings and investment transactions
  if (kinds.has("investment")) {
    if (has("investments")) {
      try {
        const H = await plaid("/investments/holdings/get", { access_token: token });
        const sec = Object.fromEntries((H.securities || []).map((s) => [s.security_id, s]));
        for (const a of accounts) {
          const hs = (H.holdings || []).filter((x) => x.account_id === a.id);
          if (!hs.length && a.type !== "investment") continue;
          a.holdings = hs.map((x) => { const s = sec[x.security_id] || {}; return { symbol: s.ticker_symbol || (s.type === "cash" ? "CASH" : s.cusip || s.name), name: s.name, type: s.type, assetType: SEC_TYPE[s.type] || "Other",
            quantity: x.quantity, price: x.institution_price, priceAsOf: x.institution_price_as_of, value: x.institution_value, costBasis: x.cost_basis, cusip: s.cusip || null }; });
          a.holdingsAsOf = isoToday();
        }
        const start = archive.invFrom[it.itemId] ? addDays(archive.invFrom[it.itemId], -30) : addDays(isoToday(), -HISTORY_DAYS);
        let offset = 0, total = 0, n = 0;
        do {
          const T = await plaid("/investments/transactions/get", { access_token: token, start_date: start, end_date: isoToday(), options: { count: 500, offset } });
          const s2 = Object.fromEntries((T.securities || []).map((s) => [s.security_id, s]));
          for (const t of T.investment_transactions || []) { upsert(archive, normInv(t, s2, it.itemId)); n++; }
          total = T.total_investment_transactions || 0; offset += (T.investment_transactions || []).length;
          if (!(T.investment_transactions || []).length) break;
        } while (offset < total);
        archive.invFrom[it.itemId] = isoToday();
        notes.push(`${n} investment transactions`);
      } catch (e) {
        if (LOGIN.has(e.code)) return loginNeeded(it, e);
        if (e.code === "PRODUCT_NOT_READY") notes.push("investment history still loading at Plaid");
        else if (NEEDS_CONSENT.has(e.code)) missing.push("investments"); else notes.push(`investments: ${e.message}`);
      }
    } else missing.push("investments");
  }

  // Loan and card details
  if (kinds.has("loan") || kinds.has("credit")) {
    if (has("liabilities")) {
      try {
        const L = await plaid("/liabilities/get", { access_token: token });
        for (const [kind, list] of Object.entries(L.liabilities || {})) for (const l of list || []) {
          const a = accounts.find((x) => x.id === l.account_id);
          if (a) a.liability = normLiability(kind, l);
        }
      } catch (e) {
        if (LOGIN.has(e.code)) return loginNeeded(it, e);
        if (NEEDS_CONSENT.has(e.code)) missing.push("liabilities"); else notes.push(`liabilities: ${e.message}`);
      }
    } else missing.push("liabilities");
  }

  // Bank and card transactions (cursor sync picks up additions, corrections and removals)
  if (kinds.has("depository") || kinds.has("credit") || kinds.has("loan")) {
    if (has("transactions")) {
      let cursor = archive.cursors[it.itemId] || undefined, added = 0, mod = 0, rem = 0, guard = 0;
      try {
        let more = true;
        while (more && guard++ < 60) {
          const S = await plaid("/transactions/sync", { access_token: token, cursor, count: 500, options: { include_original_description: false, days_requested: HISTORY_DAYS } });
          for (const t of S.added || []) { upsert(archive, normBank(t, it.itemId)); added++; }
          for (const t of S.modified || []) { upsert(archive, normBank(t, it.itemId)); mod++; }
          for (const t of S.removed || []) { removeTx(archive, t.transaction_id); rem++; }
          cursor = S.next_cursor; more = S.has_more;
          if (S.transactions_update_status) it.txStatus = S.transactions_update_status;
        }
        archive.cursors[it.itemId] = cursor;
        notes.push(`${added} new, ${mod} updated, ${rem} removed bank/card transactions`);
      } catch (e) {
        if (LOGIN.has(e.code)) return loginNeeded(it, e);
        if (e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") notes.push("Plaid was updating; the next refresh picks it up");
        else if (e.code === "PRODUCT_NOT_READY") notes.push("transaction history still loading at Plaid");
        else if (NEEDS_CONSENT.has(e.code)) missing.push("transactions"); else notes.push(`transactions: ${e.message}`);
      }
    } else missing.push("transactions");
  }

  it.accounts = accounts;
  it.missing = [...new Set(missing)];
  it.historyDays = it.historyDays || (it.products ? HISTORY_DAYS : 90);
  it.refreshedAt = new Date().toISOString();
  it.liveAt = live ? it.refreshedAt : it.liveAt || null;
  it.notes = notes;
  return it;
}
function loginNeeded(it, e) { it.error = e.message; it.errorCode = e.code; it.needsLogin = true; it.refreshedAt = new Date().toISOString(); return it; }

/* ---------------- archive ---------------- */
// Keep a person's edits (category, property, note, split) when Plaid corrects a transaction.
function upsert(archive, t) {
  const old = archive.txns[t.id];
  archive.txns[t.id] = old ? { ...t, u: old.u, firstSeen: old.firstSeen } : { ...t, firstSeen: isoToday() };
  // A posted transaction replaces its pending version (Plaid usually removes the pending one too).
  if (t.pendingId && archive.txns[t.pendingId] && t.pendingId !== t.id) {
    const p = archive.txns[t.pendingId];
    if (p.u && !archive.txns[t.id].u) archive.txns[t.id].u = p.u;
    delete archive.txns[t.pendingId];
  }
}
function removeTx(archive, id) {
  const x = archive.txns[id];
  if (!x) return;
  if (x.u) { x.removed = true; x.removedAt = isoToday(); } else delete archive.txns[id];
}

// After an institution is reconnected the transaction ids change. Match the old item's transactions
// to the new ones (account, date, amount, description), carry edits over, and drop the duplicates.
export function mergeReconnected(archive, oldItemId, newItemId, acctMap) {
  const fresh = Object.values(archive.txns).filter((x) => x.item === newItemId);
  const key = (x) => `${x.kind}|${x.acct}|${x.date}|${Math.round(x.amount * 100)}`;
  const idx = {};
  fresh.forEach((x) => { (idx[key(x)] = idx[key(x)] || []).push(x); });
  let merged = 0, kept = 0;
  const idMap = {};
  for (const [id, x] of Object.entries(archive.txns)) {
    if (x.item !== oldItemId) continue;
    const moved = { ...x, acct: acctMap[x.acct] || x.acct };
    const cands = idx[key(moved)] || [];
    const m = cands.find((c) => !c._taken);
    if (m) { m._taken = true; if (x.u && !m.u) m.u = x.u; delete archive.txns[id]; idMap[id] = m.id; merged++; }
    else { archive.txns[id] = { ...moved, item: newItemId, carried: true }; kept++; }
  }
  fresh.forEach((x) => delete x._taken);
  if (archive.cursors[oldItemId]) delete archive.cursors[oldItemId];
  if (archive.invFrom[oldItemId]) delete archive.invFrom[oldItemId];
  return { merged, kept, idMap };
}

// Rows kept from a retired connection ("carried") that later arrive again under the new connection's ids
// (Plaid loads long histories after the first sync): keep the new copy, carry edits over, drop the old.
export function dedupeCarried(archive) {
  const key = (x) => `${x.kind}|${x.acct}|${x.date}|${Math.round(x.amount * 100)}`;
  const idx = {};
  for (const x of Object.values(archive.txns)) if (!x.carried) (idx[key(x)] = idx[key(x)] || []).push(x);
  const idMap = {};
  for (const [id, x] of Object.entries(archive.txns)) {
    if (!x.carried) continue;
    const m = (idx[key(x)] || []).find((c) => !c._taken);
    if (!m) continue;
    m._taken = true;
    if (x.u && !m.u) m.u = x.u;
    delete archive.txns[id];
    idMap[id] = m.id;
  }
  for (const list of Object.values(idx)) list.forEach((x) => delete x._taken);
  return idMap;
}

// Old account id -> new account id, matched on mask, type and name.
export function mapAccounts(oldAccts, newAccts) {
  const out = {};
  for (const o of oldAccts || []) {
    const m = (newAccts || []).find((n) => n.mask === o.mask && n.type === o.type && (n.subtype === o.subtype || !o.subtype)) || (newAccts || []).find((n) => n.mask === o.mask && n.type === o.type);
    if (m) out[o.id] = m.id;
  }
  return out;
}

export const allAccounts = (store) => (store.items || []).flatMap((it) => (it.accounts || []).map((a) => ({ ...a, itemId: it.itemId, institution: it.institution })));
export { isoToday, addDays };
