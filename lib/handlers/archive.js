import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { readArchive, readStore, ARCHIVE_PATH, allAccounts } from "../plaidcore.js";
import { runFeeds } from "../plaidsync.js";

// Transaction archive: every Plaid transaction ever synced, kept after it ages out of Plaid's 24 months.
// GET ?q=&acct=&from=&to=&kind=&cat=&prop=&offset=&limit=  -> { total, rows, accounts, sums }
// POST { op: "edit", id, category?, propertyId?, note? }   edits flow to the property ledgers
const PROPS_PATH = "data/properties.json";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const archive = await readArchive();
  const store = await readStore();
  const accts = allAccounts(store);
  const acctLabel = {};
  for (const a of accts) acctLabel[a.id] = `${a.institution} ${a.shortName || a.name} …${a.mask}`;
  for (const r of store.retired || []) for (const a of r.accounts || []) if (!acctLabel[a.id]) acctLabel[a.id] = `${r.institution} ${a.shortName || a.name} …${a.mask} (old connection)`;

  if (req.method === "GET") {
    const q = String(req.query.q || "").toLowerCase().trim();
    const { acct, from, to, kind, cat, prop } = req.query;
    let rows = Object.values(archive.txns).filter((x) => !x.removed);
    if (acct) rows = rows.filter((x) => x.acct === acct);
    if (kind) rows = rows.filter((x) => x.kind === kind);
    if (from) rows = rows.filter((x) => x.date >= from);
    if (to) rows = rows.filter((x) => x.date <= to);
    if (cat) rows = rows.filter((x) => ((x.u && x.u.category) || x.pfc || "") === cat);
    if (prop) rows = rows.filter((x) => x.u && x.u.propertyId === prop);
    if (q) rows = rows.filter((x) => `${x.name} ${x.merchant || ""} ${x.sym || ""} ${(x.u && x.u.note) || ""} ${x.amount}`.toLowerCase().includes(q));
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const total = rows.length;
    const inflow = rows.reduce((s, x) => s + (x.amount < 0 ? -x.amount : 0), 0), outflow = rows.reduce((s, x) => s + (x.amount > 0 ? x.amount : 0), 0);
    const all = req.query.export === "1";
    const offset = all ? 0 : Math.max(0, Number(req.query.offset) || 0), limit = all ? 20000 : Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const oldest = Object.values(archive.txns).reduce((m, x) => (!m || x.date < m ? x.date : m), null);
    return res.status(200).json({
      total, offset, rows: rows.slice(offset, offset + limit).map((x) => ({ ...x, account: acctLabel[x.acct] || x.acct })),
      sums: { inflow: Math.round(inflow * 100) / 100, outflow: Math.round(outflow * 100) / 100 },
      accounts: Object.entries(acctLabel).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      count: Object.keys(archive.txns).length, oldest, syncedAt: archive.syncedAt || null,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  if (b.op !== "edit") return res.status(400).json({ error: "Unknown action." });
  const x = archive.txns[b.id];
  if (!x) return res.status(404).json({ error: "Transaction not found." });
  const before = x.u || {};
  const u = { ...before };
  if (b.category !== undefined) u.category = b.category ? String(b.category).slice(0, 60) : null;
  if (b.propertyId !== undefined) u.propertyId = b.propertyId ? String(b.propertyId).slice(0, 60) : null;
  if (b.note !== undefined) u.note = b.note ? String(b.note).slice(0, 500) : null;
  u.by = session.email; u.at = new Date().toISOString();
  x.u = u;
  archive.version = (archive.version || 0) + 1;
  await writeJson(ARCHIVE_PATH, archive);
  // A new category or property re-books the transaction in the property ledgers.
  if (u.category !== before.category || u.propertyId !== before.propertyId) {
    const props = await readJson(PROPS_PATH, null);
    if (props) {
      let ch = false;
      for (const p of Object.values(props.properties)) {
        const n = (p.entries || []).length;
        p.entries = (p.entries || []).filter((e) => e.txId !== b.id);
        if (p.decided && p.decided[b.id]) { delete p.decided[b.id]; ch = true; }
        if ((p.review || []).some((r) => r.txId === b.id)) { p.review = p.review.filter((r) => r.txId !== b.id); ch = true; }
        if (p.entries.length !== n) ch = true;
      }
      if (ch) { props.version = (props.version || 0) + 1; await writeJson(PROPS_PATH, props); }
    }
    await runFeeds(store, archive, session.email).catch((e) => console.error("feeds after edit", e.message));
  }
  return res.status(200).json({ ok: true, row: { ...x, account: acctLabel[x.acct] || x.acct } });
}
