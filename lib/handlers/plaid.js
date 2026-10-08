import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { INPUTS_PATH } from "../inputs.js";
import { configured, plaid, seal, open, readStore, readArchive, linkTokenBody, syncItem, PLAID_PATH, ARCHIVE_PATH, mapAccounts, productsOf } from "../plaidcore.js";
import { refreshAll, runFeeds, remapTags, retireItem } from "../plaidsync.js";

// Plaid connections (same Plaid account as vistarandall). One Connect button for every account type.
// GET                         -> { configured, canManage, env, items, archive: { count, syncedAt } }
// POST { op: "linkToken", itemId?, mode? }   mode "update" repairs a sign-in; otherwise a fresh link
//      { op: "exchange", publicToken, institution, institutionId, replaceItemId? }
//      { op: "refresh", live? } | { op: "remove", itemId } | { op: "match", plaidAccountId, accountId }
const ADMINS = ["mrice@vistamarkllc.com", "jen@blueskyinvestmentgroup.com"];

async function pub(store, email) {
  const archive = await readArchive();
  const counts = {};
  for (const x of Object.values(archive.txns)) counts[x.item] = (counts[x.item] || 0) + 1;
  return {
    configured: configured(), canManage: ADMINS.includes(email), env: process.env.PLAID_ENV === "sandbox" ? "sandbox" : "production",
    items: (store.items || []).map(({ token, ...rest }) => ({ ...rest, products: productsOf(rest), transactions: counts[rest.itemId] || 0,
      // Connections made before the single button carry one product and 90 days of history: reconnect for the rest.
      needsUpgrade: !rest.linkedV2 })),
    archive: { count: Object.keys(archive.txns).length, syncedAt: archive.syncedAt || null },
    syncedAt: store.syncedAt || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const store = await readStore();
  if (req.method === "GET") return res.status(200).json(await pub(store, session.email));
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  if (!configured()) return res.status(503).json({ error: "Plaid isn't set up on this site yet: add PLAID_SECRET (the same value vistarandall uses) to the bluesky-website Vercel project." });
  const b = await readBody(req);
  const admin = ADMINS.includes(session.email);
  let summary = null;
  try {
    switch (b.op) {
      case "linkToken": {
        if (!admin) return res.status(403).json({ error: "Only Matt and Jen can connect accounts." });
        const it = b.itemId ? store.items.find((i) => i.itemId === b.itemId) : null;
        const update = it && b.mode === "update";
        const t = await plaid("/link/token/create", linkTokenBody(session.email, update ? { accessToken: open(it.token) } : {}));
        return res.status(200).json({ linkToken: t.link_token, mode: update ? "update" : "new", replaceItemId: it && !update ? it.itemId : null, itemId: it ? it.itemId : null });
      }
      case "exchange": {
        if (!admin) return res.status(403).json({ error: "Only Matt and Jen can connect accounts." });
        const x = await plaid("/item/public_token/exchange", { public_token: String(b.publicToken || "") });
        const archive = await readArchive();
        const it = { itemId: x.item_id, token: seal(x.access_token), institution: String(b.institution || "Institution").slice(0, 80), institutionId: b.institutionId ? String(b.institutionId).slice(0, 40) : null,
          kind: "all", linkedV2: true, connectedBy: session.email, connectedAt: new Date().toISOString() };
        try { await syncItem(it, archive); } catch (e) { it.error = e.message; }
        // Reconnecting an institution already on file replaces the old connection: same bank, overlapping accounts.
        let old = b.replaceItemId ? store.items.find((i) => i.itemId === b.replaceItemId) : null;
        // Without an explicit reconnect, replace only when it's clearly the same login: same bank, and every old account is in the new one.
        if (!old && (it.accounts || []).length) old = store.items.find((i) => i.itemId !== it.itemId && ((it.institutionId && i.institutionId === it.institutionId) || i.institution === it.institution)
          && (i.accounts || []).length && (i.accounts || []).every((a) => (it.accounts || []).some((n) => n.mask === a.mask && n.type === a.type)));
        store.items = (store.items || []).filter((i) => i.itemId !== it.itemId).concat([it]);
        let map = {};
        if (old) { map = mapAccounts(old.accounts, it.accounts); await retireItem(store, old, it.itemId); }
        await writeJson(ARCHIVE_PATH, archive);
        await writeJson(PLAID_PATH, store);
        if (old) await remapTags(map);
        summary = { connected: it.institution, replaced: old ? old.institution : null, accounts: (it.accounts || []).length };
        // Fold the old history in and feed everything that reads Plaid data.
        const r = await refreshAll({ who: session.email });
        summary.feeds = r.feeds;
        return res.status(200).json({ ...(await pub(r.store, session.email)), summary });
      }
      case "refresh": {
        const r = await refreshAll({ live: !!b.live, who: session.email });
        return res.status(200).json({ ...(await pub(r.store, session.email)), summary: { results: r.results, feeds: r.feeds } });
      }
      case "remove": {
        if (!admin) return res.status(403).json({ error: "Only Matt and Jen can remove connections." });
        const it = (store.items || []).find((i) => i.itemId === b.itemId);
        if (!it) return res.status(404).json({ error: "Connection not found." });
        try { await plaid("/item/remove", { access_token: open(it.token) }); } catch {}
        store.items = store.items.filter((i) => i.itemId !== b.itemId);
        await writeJson(PLAID_PATH, store); // the archive keeps its transactions
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
        await runFeeds(store, await readArchive(), session.email).catch(() => {});
        break;
      }
      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (e) {
    console.error("plaid", b.op, e.code, e.message);
    return res.status(502).json({ error: `Plaid: ${e.message}` });
  }
  return res.status(200).json({ ...(await pub(await readStore(), session.email)), summary });
}

// Daily cron: refresh everything with the balances Plaid already has (no billed live calls).
export async function dailyPlaid() {
  if (!configured()) return { skipped: "Plaid not configured" };
  const r = await refreshAll({ who: "daily refresh" });
  return { results: r.results, feeds: r.feeds };
}
