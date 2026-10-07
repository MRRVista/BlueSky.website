import crypto from "node:crypto";
import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { INPUTS_PATH } from "../inputs.js";

// Plaid connections (same Plaid account as vistarandall). Access tokens are encrypted (AES-256-GCM) before
// they're stored in the private Blob store and are never sent to the browser.
// Env: PLAID_SECRET (required), PLAID_CLIENT_ID (defaults to the Vistamark client id), PLAID_ENV (production|sandbox),
//      PLAID_REDIRECT_URI (for OAuth banks such as Schwab; must be allow-listed in the Plaid dashboard), PLAID_TOKEN_KEY (optional).
// GET                         -> { configured, canManage, items: [{ itemId, institution, kind, accounts, refreshedAt, error }] }
// POST { op: "linkToken", kind } | { op: "exchange", publicToken, institution, kind } | { op: "refresh" } | { op: "remove", itemId } | { op: "match", plaidAccountId, accountId }
const PATH = "data/plaid.json";
const ADMINS = ["mrice@vistamarkllc.com"];
const CLIENT_ID = () => process.env.PLAID_CLIENT_ID || "6a65f8716a37c0000d33c424";
const BASE = () => `https://${process.env.PLAID_ENV === "sandbox" ? "sandbox" : "production"}.plaid.com`;
const configured = () => !!process.env.PLAID_SECRET;
const keyBytes = () => crypto.createHash("sha256").update(process.env.PLAID_TOKEN_KEY || `${process.env.SESSION_SECRET || ""}|bluesky-plaid`).digest();

function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function open(sealed) {
  const [iv, tag, enc] = sealed.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
async function plaid(route, body) {
  const r = await fetch(BASE() + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID(), secret: process.env.PLAID_SECRET, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_message || j.display_message || `Plaid ${r.status}`); e.code = j.error_code; throw e; }
  return j;
}
const pub = (store, email) => ({ configured: configured(), canManage: ADMINS.includes(email), env: process.env.PLAID_ENV === "sandbox" ? "sandbox" : "production",
  items: (store.items || []).map(({ token, ...rest }) => rest) });

async function refreshItem(it) {
  const token = open(it.token);
  const a = await plaid("/accounts/get", { access_token: token });
  let holdings = null;
  if (it.kind === "brokerage") { try { holdings = await plaid("/investments/holdings/get", { access_token: token }); } catch (e) { it.holdingsError = e.message; } }
  it.accounts = a.accounts.map((x) => {
    const h = holdings ? holdings.holdings.filter((y) => y.account_id === x.account_id) : [];
    return { id: x.account_id, name: x.official_name || x.name, mask: x.mask, type: x.type, subtype: x.subtype,
      current: x.balances.current, available: x.balances.available, currency: x.balances.iso_currency_code,
      holdings: h.length ? h.map((y) => { const sec = holdings.securities.find((s) => s.security_id === y.security_id) || {}; return { symbol: sec.ticker_symbol, name: sec.name, quantity: y.quantity, value: y.institution_value, costBasis: y.cost_basis }; }) : undefined };
  });
  it.refreshedAt = new Date().toISOString(); it.error = null;
}

// Push Plaid balances into matched accounts on the Inputs page.
async function syncInputs(store) {
  const inputs = await readJson(INPUTS_PATH, null);
  if (!inputs) return;
  let changed = false;
  for (const acc of inputs.accounts || []) {
    if (!acc.plaidAccountId) continue;
    const pa = (store.items || []).flatMap((i) => i.accounts || []).find((x) => x.id === acc.plaidAccountId);
    if (pa && pa.current != null) { acc.value = pa.current; acc.asOf = new Date().toISOString().slice(0, 10); acc.source = "plaid"; changed = true; }
  }
  if (changed) { inputs.version = (inputs.version || 0) + 1; await writeJson(INPUTS_PATH, inputs); }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const store = (await readJson(PATH, null)) || { items: [] };
  if (req.method === "GET") return res.status(200).json(pub(store, session.email));
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  if (!configured()) return res.status(503).json({ error: "Plaid isn't set up on this site yet: add PLAID_SECRET (the same value vistarandall uses) to the bluesky-website Vercel project." });
  const b = await readBody(req);
  const admin = ADMINS.includes(session.email);
  try {
    switch (b.op) {
      case "linkToken": {
        if (!admin) return res.status(403).json({ error: "Only Matt can connect accounts." });
        const kind = b.kind === "bank" ? "bank" : "brokerage";
        const body = { client_name: "Blue Sky Investment Group", user: { client_user_id: crypto.createHash("sha256").update(session.email).digest("hex").slice(0, 32) },
          products: [kind === "bank" ? "transactions" : "investments"], country_codes: ["US"], language: "en" };
        if (process.env.PLAID_REDIRECT_URI) body.redirect_uri = process.env.PLAID_REDIRECT_URI;
        const t = await plaid("/link/token/create", body);
        return res.status(200).json({ linkToken: t.link_token, kind });
      }
      case "exchange": {
        if (!admin) return res.status(403).json({ error: "Only Matt can connect accounts." });
        const x = await plaid("/item/public_token/exchange", { public_token: String(b.publicToken || "") });
        const it = { itemId: x.item_id, token: seal(x.access_token), institution: String(b.institution || "Institution").slice(0, 80), kind: b.kind === "bank" ? "bank" : "brokerage", connectedBy: session.email, connectedAt: new Date().toISOString() };
        try { await refreshItem(it); } catch (e) { it.error = e.message; }
        store.items = (store.items || []).filter((i) => i.itemId !== it.itemId).concat([it]);
        break;
      }
      case "refresh":
        for (const it of store.items || []) { try { await refreshItem(it); } catch (e) { it.error = e.message; it.errorCode = e.code || null; } }
        break;
      case "remove": {
        if (!admin) return res.status(403).json({ error: "Only Matt can remove connections." });
        const it = (store.items || []).find((i) => i.itemId === b.itemId);
        if (!it) return res.status(404).json({ error: "Connection not found." });
        try { await plaid("/item/remove", { access_token: open(it.token) }); } catch {}
        store.items = store.items.filter((i) => i.itemId !== b.itemId);
        break;
      }
      case "match": {
        const inputs = await readJson(INPUTS_PATH, null);
        const acc = inputs && inputs.accounts.find((a) => a.id === b.accountId);
        if (!acc) return res.status(404).json({ error: "Account not found on the Inputs page." });
        acc.plaidAccountId = b.plaidAccountId ? String(b.plaidAccountId).slice(0, 80) : null;
        inputs.version = (inputs.version || 0) + 1;
        inputs.log = [{ at: new Date().toISOString(), by: session.email, change: `${acc.name} ${acc.plaidAccountId ? "linked to a Plaid account" : "unlinked from Plaid"}` }].concat(inputs.log || []).slice(0, 500);
        await writeJson(INPUTS_PATH, inputs);
        break;
      }
      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (e) {
    console.error("plaid", b.op, e.code, e.message);
    return res.status(502).json({ error: `Plaid: ${e.message}` });
  }
  await writeJson(PATH, store);
  await syncInputs(store).catch(() => {});
  return res.status(200).json(pub(store, session.email));
}
