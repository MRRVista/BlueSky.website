// Full Plaid refresh: sync every connection into the archive, then push the results into the
// Schwab account data, the property ledgers and the Inputs accounts. Used by the Refresh button
// and the daily cron.
import { readJson, writeJson } from "./store.js";
import { readStore, readArchive, syncItem, PLAID_PATH, ARCHIVE_PATH, mergeReconnected, mapAccounts, allAccounts, open, plaid, dedupeCarried } from "./plaidcore.js";
import { feedPortfolio } from "./feeds.js";
import { runPropertyFeed } from "./propfeed.js";
import { INPUTS_PATH } from "./inputs.js";
import { BALANCE_PATH } from "./balance.js";
import { newId } from "./docs.js";

const PROPS_PATH = "data/properties.json";
const LOANS_PATH = "data/loans.json";

export async function refreshAll({ live = false, who = "Plaid" } = {}) {
  const store = await readStore();
  const archive = await readArchive();
  const results = [];
  const txMoves = {}, tagMoves = [];
  const startItems = (store.items || []).map((i) => i.itemId);
  for (const it of store.items || []) {
    try { await syncItem(it, archive, { live }); results.push({ institution: it.institution, ok: !it.error, notes: it.notes, missing: it.missing, error: it.error }); }
    catch (e) { it.error = e.message; it.errorCode = e.code || null; results.push({ institution: it.institution, ok: false, error: e.message }); }
  }
  // Reconnected institutions: fold the old connection's history into the new one.
  for (const r of store.retired || []) {
    if (r.merged) continue;
    const nu = (store.items || []).find((x) => x.itemId === r.replacedBy);
    if (!nu || !nu.accounts) continue;
    // Wait for Plaid to finish loading the new connection's history before matching (carried rows are re-checked every sync anyway).
    if (nu.txStatus && nu.txStatus !== "HISTORICAL_UPDATE_COMPLETE" && Date.now() - Date.parse(r.retiredAt || 0) < 3 * 864e5) continue;
    const map = mapAccounts(r.accounts, nu.accounts);
    const { idMap, ...res } = mergeReconnected(archive, r.itemId, nu.itemId, map);
    r.mergeResult = res;
    r.merged = true;
    Object.assign(txMoves, idMap);
    tagMoves.push(map);
  }
  Object.assign(txMoves, dedupeCarried(archive));
  // Someone may have edited a transaction, or connected/removed an institution, while this sync ran: merge, don't overwrite.
  const [diskArchive, diskStore] = await Promise.all([readArchive(), readStore()]);
  for (const [id, x] of Object.entries(diskArchive.txns || {})) {
    const mine = archive.txns[id] || archive.txns[txMoves[id]];
    if (mine && x.u && (!mine.u || String(x.u.at || "") > String(mine.u.at || ""))) mine.u = x.u;
  }
  const diskIds = new Set((diskStore.items || []).map((i) => i.itemId));
  const startIds = new Set(startItems);
  store.items = (store.items || []).filter((i) => diskIds.has(i.itemId) || !startIds.has(i.itemId))
    .concat((diskStore.items || []).filter((i) => !startIds.has(i.itemId) && !(store.items || []).some((x) => x.itemId === i.itemId)));
  store.retired = diskStore.retired && diskStore.retired.length > (store.retired || []).length ? diskStore.retired.map((r) => (store.retired || []).find((x) => x.itemId === r.itemId) || r) : store.retired;
  store.syncedAt = new Date().toISOString();
  archive.version = (archive.version || 0) + 1;
  archive.syncedAt = store.syncedAt;
  await writeJson(ARCHIVE_PATH, archive);
  await writeJson(PLAID_PATH, store);
  for (const m of tagMoves) await remapTags(m).catch((e) => console.error("remap tags", e.message));
  if (Object.keys(txMoves).length) await remapTxIds(txMoves).catch((e) => console.error("remap tx ids", e.message));
  const feeds = await runFeeds(store, archive, who).catch((e) => ({ error: e.message }));
  return { results, feeds, store, archive };
}

export async function runFeeds(store, archive, who = "Plaid") {
  const out = {};
  const balance = await readJson(BALANCE_PATH, null);
  out.portfolio = await feedPortfolio(store, archive, balance).catch((e) => ({ error: e.message }));
  // Property ledgers
  const props = await readJson(PROPS_PATH, null);
  if (props) {
    const loans = await readJson(LOANS_PATH, null);
    const lendersByProp = {};
    for (const l of (loans && loans.loans) || []) if (l.secures && l.lender) (lendersByProp[l.secures] = lendersByProp[l.secures] || []).push(l.lender);
    for (const [pid, p] of Object.entries(props.properties)) if (p.mortgage && p.mortgage.lender) (lendersByProp[pid] = lendersByProp[pid] || []).push(p.mortgage.lender);
    const before = JSON.stringify(props.properties);
    out.properties = runPropertyFeed(props, archive, store, { lendersByProp, who, newId });
    if (JSON.stringify(props.properties) !== before) {
      props.version = (props.version || 0) + 1; props.updatedAt = new Date().toISOString(); props.updatedBy = who;
      await writeJson(PROPS_PATH, props);
    }
  }
  // Inputs accounts linked to Plaid (kept for the tax engine, which reads them)
  const inputs = await readJson(INPUTS_PATH, null);
  if (inputs) {
    const accts = allAccounts(store);
    let changed = false;
    for (const acc of inputs.accounts || []) {
      if (!acc.plaidAccountId) continue;
      const pa = accts.find((x) => x.id === acc.plaidAccountId);
      if (pa && pa.current != null && pa.type !== "loan" && pa.type !== "credit" && acc.value !== pa.current) { acc.value = pa.current; acc.asOf = new Date().toISOString().slice(0, 10); acc.source = "plaid"; changed = true; }
    }
    if (changed) { inputs.version = (inputs.version || 0) + 1; await writeJson(INPUTS_PATH, inputs); }
  }
  return out;
}

// A reconnected institution: move every tag from the old account ids to the new ones.
export async function remapTags(map) {
  if (!Object.keys(map).length) return;
  const fix = (id) => map[id] || id;
  const balance = await readJson(BALANCE_PATH, null);
  if (balance) {
    let ch = false;
    for (const r of Object.values(balance.rows || {})) if (r.plaidAccountId && map[r.plaidAccountId]) { r.plaidAccountId = fix(r.plaidAccountId); ch = true; }
    if (balance.dismissed) balance.dismissed = balance.dismissed.map(fix);
    if (ch) { balance.version = (balance.version || 0) + 1; await writeJson(BALANCE_PATH, balance); }
  }
  const props = await readJson(PROPS_PATH, null);
  if (props) {
    let ch = false;
    for (const p of Object.values(props.properties)) if ((p.accounts || []).some((a) => map[a])) { p.accounts = p.accounts.map(fix); ch = true; }
    if (ch) { props.version = (props.version || 0) + 1; await writeJson(PROPS_PATH, props); }
  }
  const inputs = await readJson(INPUTS_PATH, null);
  if (inputs && (inputs.accounts || []).some((a) => map[a.plaidAccountId])) {
    inputs.accounts.forEach((a) => { if (map[a.plaidAccountId]) a.plaidAccountId = map[a.plaidAccountId]; });
    inputs.version = (inputs.version || 0) + 1; await writeJson(INPUTS_PATH, inputs);
  }
}

// Ledger entries, review items and decisions follow a reconnected institution's new transaction ids.
async function remapTxIds(map) {
  const props = await readJson(PROPS_PATH, null);
  if (!props) return;
  for (const p of Object.values(props.properties)) {
    for (const e of p.entries || []) if (e.txId && map[e.txId]) e.txId = map[e.txId];
    for (const e of p.trash || []) if (e.txId && map[e.txId]) e.txId = map[e.txId];
    if (p.decided) for (const [o, n] of Object.entries(map)) if (p.decided[o]) { p.decided[n] = p.decided[n] || p.decided[o]; delete p.decided[o]; }
    if (p.review) {
      const seen = new Set();
      p.review = p.review.map((r) => (map[r.txId] ? { ...r, txId: map[r.txId] } : r)).filter((r) => !seen.has(r.txId) && seen.add(r.txId) && !(p.decided && p.decided[r.txId]));
    }
  }
  props.version = (props.version || 0) + 1;
  await writeJson(PROPS_PATH, props);
}

// Retire an old connection after its replacement is in: remove it at Plaid, keep its accounts for matching.
export async function retireItem(store, old, newItemId) {
  try { await plaid("/item/remove", { access_token: open(old.token) }); } catch {}
  store.items = store.items.filter((i) => i.itemId !== old.itemId);
  const { token, ...rest } = old;
  store.retired = (store.retired || []).concat([{ ...rest, replacedBy: newItemId, retiredAt: new Date().toISOString(), merged: false }]).slice(-20);
}
