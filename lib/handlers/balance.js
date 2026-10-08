import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { BALANCE_PATH, defaultBalance, migrate, plaidList, cleanRow, systemRows } from "../balance.js";
import { ACCOUNT_GROUPS, TYPES, PROPERTY_TYPES, USE_GROUPS } from "../acctypes.js";
import { readStore, allAccounts } from "../plaidcore.js";
import { INPUTS_PATH } from "../inputs.js";
import { newId } from "../docs.js";

// Overview balance sheet: rows, order, links and Plaid tags.
// GET  -> { balance, system, plaid, groups, uses, propertyTypes }
// POST { version, op, ... } ops: add, update, link, tag, confirm, remove, restore, reorder, dismiss
const PROPS_PATH = "data/properties.json";
const LOANS_PATH = "data/loans.json";

async function loadAll(session) {
  const [bal0, props, loans, inputs, store, portfolio] = await Promise.all([readJson(BALANCE_PATH, null), readJson(PROPS_PATH, null), readJson(LOANS_PATH, null), readJson(INPUTS_PATH, null), readStore(), readJson(PORTFOLIO_PATH, null)]);
  const bal = bal0 || defaultBalance();
  const plaidAccounts = allAccounts(store);
  const hasPortfolio = !!(portfolio && portfolio.positions);
  if (!bal.migrated) {
    const at = new Date().toISOString();
    const ch = migrate(bal, { props, loans, inputs, plaidAccounts, hasPortfolio, who: session.email, at });
    if (ch.loans) await writeJson(LOANS_PATH, loans);
    if (ch.inputs) { inputs.version = (inputs.version || 0) + 1; inputs.log = [{ at, by: session.email, change: `Plaid links checked: ${ch.notes.filter((n) => /relinked/.test(n)).join("; ")}` }].concat(inputs.log || []).slice(0, 500); await writeJson(INPUTS_PATH, inputs); }
    if (ch.props) { props.version = (props.version || 0) + 1; await writeJson(PROPS_PATH, props); }
    bal.version = 1;
    await writeJson(BALANCE_PATH, bal);
  }
  return { bal, props, loans, inputs, store, plaidAccounts, hasPortfolio };
}

function payload(S) {
  return { balance: S.bal, system: systemRows({ props: S.props, loans: S.loans, inputs: S.inputs, hasPortfolio: S.hasPortfolio }), plaid: plaidList(S.plaidAccounts, S.bal),
    groups: ACCOUNT_GROUPS, uses: USE_GROUPS, propertyTypes: [...PROPERTY_TYPES],
    items: (S.store.items || []).map((it) => ({ itemId: it.itemId, institution: it.institution, needsLogin: !!it.needsLogin, needsUpgrade: !it.linkedV2, error: it.error || null, missing: it.missing || [], refreshedAt: it.refreshedAt || null })) };
}

const slug = (s) => String(s || "property").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "property";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const S = await loadAll(session);
  if (req.method === "GET") return res.status(200).json(payload(S));
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  const bal = S.bal;
  if (b.version != null && Number(b.version) !== bal.version) return res.status(409).json({ error: "Someone else changed the balance sheet a moment ago. The latest version is loaded; please redo your change.", data: payload(S) });
  const who = session.email, at = new Date().toISOString();
  const log = (change) => { bal.log = [{ at, by: who, change }].concat(bal.log || []).slice(0, 300); };
  const sysKeys = new Set(systemRows({ props: S.props, loans: S.loans, inputs: S.inputs, hasPortfolio: S.hasPortfolio }).map((r) => r.key));
  const exists = (k) => sysKeys.has(k) || (bal.rows[k] && k.startsWith("m:"));
  const label = (k) => (bal.rows[k] && bal.rows[k].name) || (systemRows({ props: S.props, loans: S.loans, inputs: S.inputs, hasPortfolio: S.hasPortfolio }).find((r) => r.key === k) || {}).name || k;
  let propsDirty = false, loansDirty = false;
  try {
    switch (b.op) {
      case "add": {
        const r = cleanRow(b.row || {});
        if (!r.type) throw new Error("Pick a type.");
        if (TYPES[r.type].side !== r.side) r.side = TYPES[r.type].side;
        if (r.plaidAccountId && !S.plaidAccounts.some((a) => a.id === r.plaidAccountId)) throw new Error("That Plaid account isn't connected.");
        if (r.plaidAccountId && Object.entries(bal.rows).some(([k, x]) => x.plaidAccountId === r.plaidAccountId && !(bal.hidden || []).includes(k))) throw new Error("That Plaid account is already on the balance sheet.");
        if (!r.name) { const a = S.plaidAccounts.find((x) => x.id === r.plaidAccountId); r.name = a ? `${a.institution} ${a.shortName || a.name} …${a.mask}` : null; }
        if (!r.name) throw new Error("Name it.");
        if (!r.plaidAccountId && r.value == null) throw new Error("Enter its value, or pick a Plaid account.");
        let key;
        if (PROPERTY_TYPES.has(r.type) && r.side === "asset" && !r.plaidAccountId) {
          // A building: it gets its own page on the Properties tab.
          if (!S.props) throw new Error("Properties aren't set up yet.");
          let id = slug(r.name); while (S.props.properties[id]) id = `${slug(r.name)}-${Math.random().toString(36).slice(2, 5)}`;
          S.props.properties[id] = { name: r.name, status: "active", building: { currentValue: r.value, valueAsOf: r.asOf || at.slice(0, 10), valuationMethod: "entered" }, mortgage: null, entries: [], trash: [],
            log: [{ at, by: who, change: "Added on the Overview" }], profile: { useType: r.type }, accounts: [], tenants: [], leases: [], review: [], decided: {}, rules: {} };
          S.props.order = (S.props.order || []).concat([id]);
          S.props.version = (S.props.version || 0) + 1; propsDirty = true;
          key = `sys:prop:${id}`;
          bal.rows[key] = { key };
        } else {
          key = `m:${newId()}`;
          bal.rows[key] = { key, ...r, createdBy: who, createdAt: at };
        }
        bal.order[r.side] = (bal.order[r.side] || []).filter((k) => k !== key).concat([key]);
        log(`Added ${r.name} (${TYPES[r.type].label}${r.plaidAccountId ? ", Plaid" : ""})`);
        break;
      }
      case "update": {
        if (!exists(b.key)) throw new Error("That row no longer exists. Refresh the page.");
        const cur = bal.rows[b.key] || { key: b.key };
        const patch = b.patch || {};
        if (b.key.startsWith("m:")) {
          const r = cleanRow({ ...cur, ...patch });
          if (r.type && TYPES[r.type].side !== r.side) r.side = TYPES[r.type].side;
          bal.rows[b.key] = { ...cur, ...r, updatedBy: who, updatedAt: at };
        } else {
          if (patch.type !== undefined) { if (!TYPES[patch.type]) throw new Error("Unknown type."); cur.type = patch.type; }
          if (patch.name !== undefined) cur.name = String(patch.name || "").slice(0, 120).trim() || null;
          bal.rows[b.key] = { ...cur, updatedBy: who, updatedAt: at };
          if (b.key.startsWith("sys:prop:") && patch.type) {
            const p = S.props.properties[b.key.slice(9)];
            if (p) { p.profile = { ...(p.profile || {}), useType: patch.type }; S.props.version++; propsDirty = true; }
          }
        }
        log(`Updated ${label(b.key)}`);
        break;
      }
      case "link": {
        if (!exists(b.key)) throw new Error("That row no longer exists. Refresh the page.");
        const to = b.linkedTo || null;
        if (to && !exists(to)) throw new Error("That asset no longer exists.");
        if (b.key.startsWith("sys:loan:")) {
          const l = S.loans.loans.find((x) => `sys:loan:${x.id}` === b.key);
          l.secures = !to ? "other" : to === "sys:portfolio" ? "portfolio" : to.startsWith("sys:prop:") ? to.slice(9) : "other";
          if (to && l.secures === "other") { bal.rows[b.key] = { ...(bal.rows[b.key] || { key: b.key }), linkedTo: to }; } else if (bal.rows[b.key]) delete bal.rows[b.key].linkedTo;
          l.history = (l.history || []).concat([{ at, by: who, change: `Linked to ${to ? label(to) : "nothing"} (Overview)` }]).slice(-100);
          loansDirty = true;
        } else if (b.key.startsWith("sys:pm:") || b.key === "sys:margin") {
          throw new Error("This loan belongs to its asset; change it where it's entered.");
        } else bal.rows[b.key] = { ...(bal.rows[b.key] || { key: b.key }), linkedTo: to };
        log(`${label(b.key)} linked to ${to ? label(to) : "nothing"}`);
        break;
      }
      case "tag": {
        if (!exists(b.key)) throw new Error("That row no longer exists. Refresh the page.");
        const id = b.plaidAccountId || null;
        if (id && !S.plaidAccounts.some((a) => a.id === id)) throw new Error("That Plaid account isn't connected.");
        if (id && Object.entries(bal.rows).some(([k, x]) => k !== b.key && x.plaidAccountId === id && !(bal.hidden || []).includes(k))) throw new Error("That Plaid account is already tagged to another row.");
        bal.rows[b.key] = { ...(bal.rows[b.key] || { key: b.key }), plaidAccountId: id, autoMatched: false };
        if (b.key.startsWith("m:")) bal.rows[b.key].source = id ? "plaid" : "manual";
        // The Inputs account (read by the tax engine) follows its row's tag.
        if (b.key.startsWith("sys:acct:") && S.inputs) {
          const a = S.inputs.accounts.find((x) => `sys:acct:${x.id}` === b.key);
          const pa = S.plaidAccounts.find((x) => x.id === id);
          if (a) { a.plaidAccountId = id; if (pa && pa.current != null) { a.value = pa.current; a.asOf = at.slice(0, 10); a.source = "plaid"; } else if (!id) a.source = "manual"; S.inputs.version = (S.inputs.version || 0) + 1; await writeJson(INPUTS_PATH, S.inputs); }
        }
        const pa = S.plaidAccounts.find((x) => x.id === id);
        log(id ? `${label(b.key)} tagged to Plaid ${pa.institution} …${pa.mask}` : `${label(b.key)} untagged from Plaid`);
        break;
      }
      case "confirm": {
        if (!bal.rows[b.key]) throw new Error("Nothing to confirm.");
        bal.rows[b.key].autoMatched = false;
        log(`Confirmed the Plaid match for ${label(b.key)}`);
        break;
      }
      case "remove": {
        if (!exists(b.key)) throw new Error("That row no longer exists. Refresh the page.");
        bal.hidden = [...new Set((bal.hidden || []).concat([b.key]))];
        if (b.key.startsWith("sys:prop:")) {
          const p = S.props.properties[b.key.slice(9)];
          if (p && p.status !== "archived") { p.prevStatus = p.status; p.status = "archived"; p.log = [{ at, by: who, change: "Removed from the balance sheet (history kept)" }].concat(p.log || []).slice(0, 300); S.props.version++; propsDirty = true; }
        }
        log(`Removed ${label(b.key)} from the balance sheet`);
        break;
      }
      case "restore": {
        bal.hidden = (bal.hidden || []).filter((k) => k !== b.key);
        if (b.key.startsWith("sys:prop:")) {
          const p = S.props.properties[b.key.slice(9)];
          if (p && p.status === "archived") { p.status = p.prevStatus && p.prevStatus !== "archived" ? p.prevStatus : "active"; delete p.prevStatus; p.log = [{ at, by: who, change: "Restored to the balance sheet" }].concat(p.log || []).slice(0, 300); S.props.version++; propsDirty = true; }
        }
        log(`Restored ${label(b.key)}`);
        break;
      }
      case "reorder": {
        const side = b.side === "liability" ? "liability" : "asset";
        const keys = (Array.isArray(b.keys) ? b.keys : []).map(String).filter((k) => exists(k)).slice(0, 300);
        bal.order[side] = [...new Set(keys)];
        log(`Reordered ${side === "asset" ? "assets" : "liabilities"}`);
        break;
      }
      case "dismiss": {
        const id = String(b.plaidAccountId || "");
        bal.dismissed = b.undo ? (bal.dismissed || []).filter((x) => x !== id) : [...new Set((bal.dismissed || []).concat([id]))];
        break;
      }
      default:
        throw new Error("Unknown action.");
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  bal.version = (bal.version || 0) + 1;
  bal.updatedAt = at; bal.updatedBy = who;
  try {
    if (propsDirty) { S.props.updatedAt = at; S.props.updatedBy = who; await writeJson(PROPS_PATH, S.props); }
    if (loansDirty) await writeJson(LOANS_PATH, S.loans);
    await writeJson(BALANCE_PATH, bal);
  } catch (err) { console.error("balance save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json(payload(S));
}
