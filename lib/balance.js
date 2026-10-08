// Balance sheet structure: which rows show on the Overview, in what order, their type, Plaid tag and
// links. Values are worked out in the browser from the same sources every tab uses (positions,
// properties, Admin loans, Inputs accounts) or from Plaid; manual rows carry their own value.
//
// Row keys: "sys:portfolio", "sys:prop:<id>", "sys:loan:<id>", "sys:pm:<propId>" (Properties-tab
// mortgage), "sys:margin" (implied by positions), "sys:acct:<inputsId>", "sys:cash", or "m:<id>"
// (added on the Overview, manual or Plaid).
import { TYPES, plaidType, plaidSide } from "./acctypes.js";

export const BALANCE_PATH = "data/balance.json";
export const defaultBalance = () => ({ version: 0, rows: {}, order: { asset: [], liability: [] }, hidden: [], dismissed: [], log: [], migrated: false });

const tokens = (name) => String(name || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !["street", "st", "the", "ave", "road"].includes(t));
const nameHits = (acctName, propName) => { const pt = tokens(propName), an = String(acctName || "").toLowerCase(); return pt.length && pt.every((t) => an.includes(t)); };
const ACCT_TYPE = { ira: "ira", roth: "roth", taxable: "brokerage", bank: "checking", other: "otherasset" };

// Keys of every system row the data supports right now, with defaults.
export function systemRows({ props, loans, inputs, hasPortfolio }) {
  const out = [];
  if (hasPortfolio) out.push({ key: "sys:portfolio", side: "asset", type: "brokerage", name: "Schwab account …965" });
  for (const id of (props && (props.order || Object.keys(props.properties))) || []) {
    const p = props.properties[id];
    if (!p || p.status === "coming-soon") continue;
    out.push({ key: `sys:prop:${id}`, side: "asset", type: (p.profile && p.profile.useType) || "realestate2", name: p.name, archived: p.status === "archived" });
  }
  for (const a of (inputs && inputs.accounts) || []) out.push({ key: `sys:acct:${a.id}`, side: "asset", type: ACCT_TYPE[a.type] || "otherasset", name: a.name, value: a.value, asOf: a.asOf, source: a.source });
  for (const l of ((loans && loans.loans) || []).filter((x) => (x.status || "open") === "open")) {
    out.push({ key: `sys:loan:${l.id}`, side: "liability", type: l.kind === "margin" ? "margin" : l.kind === "line" ? "heloc" : l.secures && l.secures !== "portfolio" && l.secures !== "other" ? "mortgage" : "otherdebt", name: l.name });
  }
  for (const id of (props && Object.keys(props.properties)) || []) {
    const p = props.properties[id];
    if (p && p.mortgage && p.status === "active") out.push({ key: `sys:pm:${id}`, side: "liability", type: "mortgage", name: `${p.name} mortgage` });
  }
  return out;
}

// One-time setup on the first load: tag the accounts Jen already connected, tie loans to what secures them,
// set property types, and tag each property's bank accounts. Every automatic match is marked for review.
export function migrate(bal, { props, loans, inputs, plaidAccounts, hasPortfolio, who, at }) {
  const changes = { loans: false, inputs: false, props: false, notes: [] };
  const taken = new Set();
  const tag = (key, acct, label) => {
    if (!acct || taken.has(acct.id)) return;
    taken.add(acct.id);
    bal.rows[key] = { ...(bal.rows[key] || {}), key, plaidAccountId: acct.id, autoMatched: true };
    changes.notes.push(`${label || key} matched to Plaid ${acct.institution} ${acct.shortName || acct.name} …${acct.mask}`);
  };
  const inv = plaidAccounts.filter((a) => a.type === "investment");
  if (hasPortfolio) tag("sys:portfolio", inv.find((a) => a.mask === "0965"), "Schwab account …965");

  // Inputs accounts (the IRA): keep a correct tag, fix one pointing at the wrong kind of account.
  for (const a of (inputs && inputs.accounts) || []) {
    const cur = plaidAccounts.find((x) => x.id === a.plaidAccountId);
    const wantRet = a.type === "ira" || a.type === "roth";
    let pick = cur;
    if (!cur || (wantRet && (cur.type !== "investment" || !/ira|roth|rollover|retire/i.test(`${cur.subtype} ${cur.name}`)))) {
      const cands = inv.filter((x) => !taken.has(x.id) && (a.type === "roth" ? /roth/i.test(`${x.subtype} ${x.name}`) && !/custodial/i.test(x.name) : /ira|rollover/i.test(`${x.subtype} ${x.name}`) && !/roth/i.test(`${x.subtype} ${x.name}`)));
      pick = cands.sort((x, y) => Math.abs((x.current || 0) - (a.value || 0)) - Math.abs((y.current || 0) - (a.value || 0)))[0] || null;
      if (pick && pick.id !== a.plaidAccountId) {
        changes.notes.push(`${a.name} was linked to ${cur ? `${cur.institution} ${cur.shortName || cur.name} …${cur.mask} (a ${cur.type} account)` : "nothing"}; relinked to ${pick.institution} ${pick.shortName || pick.name} …${pick.mask}`);
        a.plaidAccountId = pick.id; a.value = pick.current; a.asOf = at.slice(0, 10); a.source = "plaid"; changes.inputs = true;
      }
    }
    if (pick) tag(`sys:acct:${a.id}`, pick, a.name);
  }

  // Loans: tie each to what secures it, then to its Plaid loan account.
  const propIds = props ? Object.keys(props.properties) : [];
  for (const l of ((loans && loans.loans) || []).filter((x) => (x.status || "open") === "open")) {
    if (!l.secures) {
      const n = `${l.name || ""} ${l.notes || ""}`.toLowerCase();
      const pid = l.kind === "margin" ? "portfolio" : propIds.find((id) => nameHits(n, props.properties[id].name)) || null;
      if (pid) { l.secures = pid; changes.loans = true; changes.notes.push(`${l.name} tied to ${pid === "portfolio" ? "the Schwab account" : props.properties[pid].name}`); }
    }
    if (l.kind === "margin") continue;
    const pname = l.secures && props && props.properties[l.secures] ? props.properties[l.secures].name : null;
    const lenderTok = tokens(l.lender)[0];
    const loanAccts = plaidAccounts.filter((a) => a.type === "loan" && !taken.has(a.id));
    const m = loanAccts.find((a) => pname && nameHits(a.name, pname)) || loanAccts.find((a) => lenderTok && String(a.institution).toLowerCase().includes(lenderTok));
    if (m) tag(`sys:loan:${l.id}`, m, l.name);
  }
  // Properties-tab mortgages without an Admin loan: a Plaid loan named for the property, or the lone loan at
  // a bank that holds an account named for the property.
  for (const id of propIds) {
    const p = props.properties[id];
    if (!p.mortgage || p.status !== "active") continue;
    if (((loans && loans.loans) || []).some((l) => (l.status || "open") === "open" && l.secures === id && l.kind !== "margin")) continue;
    const loanAccts = plaidAccounts.filter((a) => a.type === "loan" && !taken.has(a.id));
    let m = loanAccts.find((a) => nameHits(a.name, p.name));
    if (!m) {
      const banks = new Set(plaidAccounts.filter((a) => a.type === "depository" && nameHits(a.name, p.name)).map((a) => a.itemId));
      const at2 = loanAccts.filter((a) => banks.has(a.itemId));
      if (at2.length === 1) m = at2[0];
    }
    if (m) tag(`sys:pm:${id}`, m, `${p.name} mortgage`);
  }

  // Property bank accounts and types.
  if (props) for (const id of propIds) {
    const p = props.properties[id];
    p.profile = p.profile || {};
    if (!p.profile.useType) { p.profile.useType = id === "5100-main" ? "remixed" : id === "333-chestnut" ? "remedical" : "realestate2"; changes.props = true; }
    const accts = plaidAccounts.filter((a) => a.type === "depository" && nameHits(a.name, p.name)).map((a) => a.id);
    // An escrow account at the bank holding the property's loan pays its taxes and insurance.
    const loanKey = Object.entries(bal.rows).find(([k, r]) => (k === `sys:pm:${id}` || (k.startsWith("sys:loan:") && ((loans && loans.loans) || []).some((l) => `sys:loan:${l.id}` === k && l.secures === id))) && r.plaidAccountId);
    if (loanKey) {
      const la = plaidAccounts.find((a) => a.id === loanKey[1].plaidAccountId);
      if (la) plaidAccounts.filter((a) => a.itemId === la.itemId && a.type === "depository" && /escrow/i.test(a.name)).forEach((a) => accts.push(a.id));
    }
    const add = accts.filter((x) => !(p.accounts || []).includes(x));
    if (add.length) {
      p.accounts = (p.accounts || []).concat(add); p.accountsAuto = (p.accountsAuto || []).concat(add); changes.props = true;
      add.forEach((x) => { const a = plaidAccounts.find((y) => y.id === x); changes.notes.push(`${p.name}: tagged ${a.institution} ${a.shortName || a.name} …${a.mask}`); });
    }
  }
  bal.migrated = true;
  bal.log = [{ at, by: who, change: `Balance sheet set up. ${changes.notes.join("; ")}` }].concat(bal.log || []).slice(0, 300);
  return changes;
}

// Plaid accounts with the type and side the balance sheet would give them, and which row (if any) uses each.
export function plaidList(plaidAccounts, bal) {
  const tagged = {};
  for (const [k, r] of Object.entries(bal.rows || {})) if (r.plaidAccountId && !(bal.hidden || []).includes(k)) tagged[r.plaidAccountId] = k;
  return plaidAccounts.map((a) => ({ id: a.id, itemId: a.itemId, institution: a.institution, name: a.name, shortName: a.shortName, mask: a.mask, type: a.type, subtype: a.subtype,
    current: a.current, available: a.available, liability: a.liability || null, holdings: a.holdings ? a.holdings.length : 0,
    suggestedType: plaidType(a), suggestedSide: plaidSide(a), row: tagged[a.id] || null, dismissed: (bal.dismissed || []).includes(a.id) }));
}

export function cleanRow(r = {}) {
  const type = TYPES[r.type] ? r.type : null;
  const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v, n = 120) => (v == null ? null : String(v).slice(0, n).trim() || null);
  return { side: r.side === "liability" ? "liability" : "asset", type, name: str(r.name), source: r.plaidAccountId ? "plaid" : "manual",
    plaidAccountId: str(r.plaidAccountId, 80), value: num(r.value), asOf: /^\d{4}-\d{2}-\d{2}$/.test(r.asOf || "") ? r.asOf : null,
    linkedTo: str(r.linkedTo, 80), rate: num(r.rate), notes: str(r.notes, 1000) };
}
