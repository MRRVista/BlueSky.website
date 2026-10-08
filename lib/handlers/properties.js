import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { newId } from "../docs.js";
import { ensureCategories } from "../propfeed.js";
import { USES } from "../acctypes.js";
import { readStore, readArchive } from "../plaidcore.js";
import { runFeeds } from "../plaidsync.js";

// Real estate held alongside the strip: building facts, a ledger of rent and expenses,
// and the mortgage terms. Saved in the private Blob store, shared by every signed-in user.
const PATH = "data/properties.json";

const DEFAULT_CATEGORIES = [
  { name: "Rent", type: "income" },
  { name: "Property tax", type: "expense" },
  { name: "Insurance", type: "expense" },
  { name: "Repairs & maintenance", type: "expense" },
  { name: "Utilities", type: "expense" },
  { name: "Management", type: "expense" },
  { name: "Other", type: "expense" },
];
const emptyProperty = (name, status) => ({ name, status, building: {}, mortgage: null, entries: [], trash: [], log: [] });
const seed = () => ({
  version: 1,
  categories: DEFAULT_CATEGORIES,
  order: ["5100-main", "333-chestnut"],
  properties: {
    "5100-main": emptyProperty("5100 Main", "active"),
    "333-chestnut": emptyProperty("333 Chestnut", "coming-soon"),
  },
});

const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, n = 200) => (v == null ? null : String(v).slice(0, n).trim() || null);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const round2 = (n) => Math.round(n * 100) / 100;

const BUILDING_NUM = ["purchasePrice", "currentValue", "squareFeet", "units",
  // valuation and pro forma inputs (percents as 6.5 = 6.5%)
  "capRate", "grossRent", "vacancyPct", "opexAnnual", "landPct", "improvements"];
const BUILDING_TXT = ["address", "purchaseDate", "valueAsOf", "notes", "propertyType", "valuationMethod", "noiSource", "placedInService"];
const CHOICES = { propertyType: ["residential", "commercial", "mixed"], valuationMethod: ["cap", "entered"], noiSource: ["auto", "actual", "proforma"] };
function cleanBuilding(b = {}) {
  const o = {};
  for (const k of BUILDING_NUM) if (k in b) o[k] = num(b[k]);
  for (const k of BUILDING_TXT) {
    if (!(k in b)) continue;
    if (CHOICES[k]) o[k] = CHOICES[k].includes(b[k]) ? b[k] : null;
    else o[k] = k.endsWith("Date") || k === "valueAsOf" || k === "placedInService" ? isoDate(b[k]) : str(b[k], k === "notes" ? 4000 : 300);
  }
  if (o.capRate != null && !(o.capRate > 0 && o.capRate < 30)) throw new Error("Enter the cap rate as a percent, e.g. 6.5.");
  if (o.vacancyPct != null && !(o.vacancyPct >= 0 && o.vacancyPct < 100)) throw new Error("Vacancy must be between 0 and 100%.");
  if (o.landPct != null && !(o.landPct >= 0 && o.landPct < 100)) throw new Error("Land share must be between 0 and 100%.");
  return o;
}

const MORT_NUM = ["amount", "rate", "amortYears", "termYears", "paymentOverride"];
const MORT_TXT = ["lender", "loanDate", "firstPaymentDate", "notes"];
function cleanMortgage(m = {}) {
  const o = {};
  for (const k of MORT_NUM) o[k] = num(m[k]);
  for (const k of MORT_TXT) o[k] = k.endsWith("Date") ? isoDate(m[k]) : str(m[k], k === "notes" ? 4000 : 200);
  if (!(o.amount > 0)) throw new Error("Enter the loan amount.");
  if (!(o.rate >= 0 && o.rate < 30)) throw new Error("Enter the interest rate as a percent, e.g. 6.25.");
  if (!(o.amortYears > 0 && o.amortYears <= 50)) throw new Error("Enter the amortization period in years (1–50).");
  if (!o.loanDate) throw new Error("Enter the loan date.");
  if (!o.firstPaymentDate) {
    // Default: first of the month after the month following the loan date (typical US mortgage).
    const [y, mo] = o.loanDate.split("-").map(Number);
    o.firstPaymentDate = new Date(Date.UTC(y, mo + 1, 1)).toISOString().slice(0, 10);
  }
  if (o.firstPaymentDate < o.loanDate) throw new Error("The first payment can't be before the loan date.");
  if (o.termYears != null && !(o.termYears > 0 && o.termYears <= o.amortYears)) throw new Error("The term (balloon) must be between 0 and the amortization period.");
  return o;
}

const PROFILE_NUM = ["rentableSf", "grossSf", "equityInvested", "assessedValue", "taxRate", "insurancePremium", "insuranceCoverage", "capexReserve", "originalLoan"];
const PROFILE_TXT = ["covenants", "taxPin", "insuranceCarrier", "costSeg", "exchange1031", "notes", "useType"];
const PROFILE_DATE = ["appealDeadline", "insuranceRenewal", "rateResetDate"];
function cleanProfile(p = {}) {
  const o = {};
  for (const k of PROFILE_NUM) if (k in p) o[k] = num(p[k]);
  for (const k of PROFILE_TXT) if (k in p) o[k] = str(p[k], k === "notes" || k === "covenants" || k === "exchange1031" ? 2000 : 120);
  for (const k of PROFILE_DATE) if (k in p) o[k] = isoDate(p[k]);
  if ("useMix" in p) {
    const mix = (Array.isArray(p.useMix) ? p.useMix : []).map((m) => ({ use: USES.includes(m.use) ? m.use : null, pct: num(m.pct) })).filter((m) => m.use && m.pct > 0).slice(0, 15);
    const tot = mix.reduce((a, m) => a + m.pct, 0);
    if (mix.length && Math.abs(tot - 100) > 0.5) throw new Error(`The use mix adds to ${Math.round(tot * 10) / 10}%; it needs to add to 100%.`);
    o.useMix = mix;
  }
  if ("reserves" in p) o.reserves = (Array.isArray(p.reserves) ? p.reserves : []).map((r) => ({ year: num(r.year), capex: num(r.capex), ti: num(r.ti), lc: num(r.lc) })).filter((r) => r.year > 1990 && r.year < 2100).slice(0, 40);
  if (o.taxRate != null && !(o.taxRate >= 0 && o.taxRate < 50)) throw new Error("Enter the tax rate as a percent, e.g. 7.2.");
  return o;
}
export function cleanLease(l = {}) {
  const d = (v) => isoDate(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    tenant: str(l.tenant, 160), guarantor: str(l.guarantor, 160), suite: str(l.suite, 60), sf: num(l.sf), useType: USES.includes(l.useType) ? l.useType : null, permittedUse: str(l.permittedUse, 600),
    commencement: d(l.commencement), expiration: d(l.expiration), rentStart: d(l.rentStart),
    rentSchedule: arr(l.rentSchedule).map((r) => ({ start: d(r.start), end: d(r.end), monthly: num(r.monthly), annualPsf: num(r.annualPsf) })).filter((r) => r.start || r.monthly).slice(0, 60),
    escalation: l.escalation ? { type: ["fixed_pct", "fixed_amount", "cpi", "none", "other"].includes(l.escalation.type) ? l.escalation.type : "other", pct: num(l.escalation.pct), note: str(l.escalation.note, 300) } : null,
    freeRent: arr(l.freeRent).map((r) => ({ start: d(r.start), end: d(r.end), note: str(r.note, 200) })).slice(0, 10),
    leaseType: ["gross", "modified_gross", "nnn", "other"].includes(l.leaseType) ? l.leaseType : null, reimbursements: arr(l.reimbursements).map((x) => str(x, 80)).filter(Boolean).slice(0, 12),
    renewalOptions: arr(l.renewalOptions).map((r) => ({ term: str(r.term, 80), noticeBy: d(r.noticeBy), notice: str(r.notice, 300), rentBasis: str(r.rentBasis, 200) })).slice(0, 6),
    termination: str(l.termination, 800), expansion: str(l.expansion, 800), securityDeposit: num(l.securityDeposit), exclusives: str(l.exclusives, 800),
    pages: l.pages && typeof l.pages === "object" ? Object.fromEntries(Object.entries(l.pages).slice(0, 40).map(([k, v]) => [String(k).slice(0, 40), num(v)]).filter(([, v]) => v > 0)) : {},
    notes: str(l.notes, 2000),
  };
}

function cleanEntry(e, cats) {
  const date = isoDate(e.date);
  if (!date) throw new Error("Each entry needs a date.");
  const category = str(e.category, 60);
  if (!category || !cats.some((c) => c.name === category)) throw new Error(`Unknown category "${e.category}".`);
  const amount = num(e.amount);
  if (amount == null || amount === 0) throw new Error("Each entry needs a non-zero amount.");
  return { date, category, amount: round2(amount), description: str(e.description, 300) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const data = (await readJson(PATH, null)) || seed();
  ensureCategories(data);

  if (req.method === "GET") return res.status(200).json(data);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const b = await readBody(req);
  if (b.version != null && Number(b.version) !== data.version) {
    return res.status(409).json({ error: "Someone else saved a change a moment ago. The latest version is loaded; please redo your change.", data });
  }
  const who = session.email, at = new Date().toISOString();

  try {
    if (b.op === "addCategory") {
      const name = str(b.name, 60);
      if (!name) throw new Error("Name the category.");
      if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error("That category already exists.");
      data.categories.push({ name, type: b.type === "income" ? "income" : "expense" });
    } else {
      const p = data.properties[b.property];
      if (!p) throw new Error("Unknown property.");
      const log = (change) => { p.log = [{ at, by: who, change }].concat(p.log || []).slice(0, 300); };
      if (b.op === "activate") {
        if (p.status === "active") throw new Error(`${p.name} is already set up.`);
        p.status = "active";
        log("Property switched on");
        b.op = "_done";
      } else if (p.status !== "active") throw new Error(`${p.name} isn't set up yet.`);

      switch (b.op) {
        case "addEntries": {
          const list = (Array.isArray(b.entries) ? b.entries : []).slice(0, 2000).map((e) => cleanEntry(e, data.categories));
          if (!list.length) throw new Error("Nothing to add.");
          const source = str(b.source, 200) || "manual";
          let removed = 0;
          if (b.mode === "replace") {
            const cats = new Set(Array.isArray(b.replaceCategories) && b.replaceCategories.length ? b.replaceCategories : list.map((e) => e.category));
            const keep = [], gone = [];
            p.entries.forEach((e) => (cats.has(e.category) ? gone : keep).push(e));
            removed = gone.length;
            p.entries = keep;
            p.trash = gone.map((e) => ({ ...e, deletedBy: who, deletedAt: at, deletedReason: "replaced by upload" })).concat(p.trash || []).slice(0, 2000);
          }
          p.entries.push(...list.map((e) => ({ id: newId(), ...e, source, createdBy: who, createdAt: at, updatedBy: who, updatedAt: at })));
          p.entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
          log(`${b.mode === "replace" ? `Replaced ${removed} entr${removed === 1 ? "y" : "ies"} with` : "Added"} ${list.length} entr${list.length === 1 ? "y" : "ies"}${source !== "manual" ? ` from ${source}` : ""}`);
          break;
        }
        case "updateEntry": {
          const e = p.entries.find((x) => x.id === b.id);
          if (!e) throw new Error("That entry no longer exists. Refresh the page.");
          const c = cleanEntry({ ...e, ...b.entry }, data.categories);
          const changed = Object.keys(c).filter((k) => String(c[k] ?? "") !== String(e[k] ?? ""));
          Object.assign(e, c, { updatedBy: who, updatedAt: at });
          p.entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
          log(`Edited ${e.category} ${e.date}${changed.length ? ` (${changed.join(", ")})` : ""}`);
          break;
        }
        case "deleteEntries": {
          const ids = new Set(Array.isArray(b.ids) ? b.ids : [b.id]);
          const gone = p.entries.filter((x) => ids.has(x.id));
          if (!gone.length) throw new Error("That entry no longer exists.");
          p.entries = p.entries.filter((x) => !ids.has(x.id));
          p.trash = gone.map((e) => ({ ...e, deletedBy: who, deletedAt: at })).concat(p.trash || []).slice(0, 2000);
          log(gone.length === 1 ? `Deleted ${gone[0].category} ${gone[0].date}` : `Deleted ${gone.length} entries`);
          break;
        }
        case "restoreEntries": {
          const ids = new Set(Array.isArray(b.ids) ? b.ids : [b.id]);
          const back = (p.trash || []).filter((x) => ids.has(x.id));
          if (!back.length) throw new Error("Not in recently deleted.");
          p.trash = p.trash.filter((x) => !ids.has(x.id));
          back.forEach((e) => { delete e.deletedBy; delete e.deletedAt; delete e.deletedReason; e.updatedBy = who; e.updatedAt = at; });
          p.entries.push(...back);
          p.entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
          log(`Restored ${back.length} entr${back.length === 1 ? "y" : "ies"}`);
          break;
        }
        case "setMortgage": {
          const m = cleanMortgage(b.mortgage || {});
          const had = !!p.mortgage;
          p.mortgage = { ...m, updatedBy: who, updatedAt: at };
          log(had ? "Mortgage terms updated" : "Mortgage added");
          break;
        }
        case "clearMortgage":
          p.mortgage = null;
          log("Mortgage removed");
          break;
        case "setBuilding":
          p.building = { ...cleanBuilding(b.building || {}), updatedBy: who, updatedAt: at };
          log("Building details updated");
          break;
        case "setProfile": {
          const pr = cleanProfile({ ...(p.profile || {}), ...(b.profile || {}) });
          p.profile = { ...(p.profile || {}), ...pr, updatedBy: who, updatedAt: at };
          if (pr.rentableSf != null || pr.grossSf != null) p.building = { ...(p.building || {}), squareFeet: pr.grossSf ?? (p.building || {}).squareFeet ?? pr.rentableSf };
          log("Property profile updated");
          break;
        }
        case "setAccounts": {
          const ids = (Array.isArray(b.accounts) ? b.accounts : []).map((x) => String(x).slice(0, 80)).slice(0, 40);
          const removed = (p.accounts || []).filter((x) => !ids.includes(x));
          p.accounts = ids; p.accountsAuto = [];
          // Untagging an account takes its unreviewed items off the list (posted entries stay).
          if (removed.length) p.review = (p.review || []).filter((r) => !removed.includes(r.acct));
          log(`Bank accounts tagged: ${ids.length}`);
          b._feed = true;
          break;
        }
        case "confirmAccounts":
          p.accountsAuto = [];
          log("Confirmed the automatically tagged bank accounts");
          break;
        case "tenant": {
          p.tenants = p.tenants || [];
          let tn = b.id ? p.tenants.find((x) => x.id === b.id) : null;
          if (b.id && !tn) throw new Error("That tenant no longer exists. Refresh the page.");
          const t = b.tenant || {};
          if (!tn) { tn = { id: newId(), keys: [], status: "active", source: "manual", alertDay: 10, createdAt: at }; p.tenants.push(tn); }
          if (t.name !== undefined) tn.name = str(t.name, 120) || tn.name;
          if (!tn.name) throw new Error("Name the tenant.");
          if (t.expected !== undefined) tn.expected = num(t.expected);
          if (t.alertDay !== undefined) { const d = num(t.alertDay); tn.alertDay = d >= 1 && d <= 28 ? Math.round(d) : 10; }
          if (t.status !== undefined && ["active", "rejected", "suggested", "former"].includes(t.status)) tn.status = t.status;
          if (Array.isArray(t.keys)) tn.keys = [...new Set(t.keys.map((k) => String(k).toLowerCase().slice(0, 60)).filter(Boolean))];
          if (t.addPayer) tn.keys = [...new Set(tn.keys.concat([String(t.addPayer).toLowerCase().slice(0, 60)]))];
          if (t.leaseId !== undefined) tn.leaseId = t.leaseId || null;
          if (t.suite !== undefined) tn.suite = str(t.suite, 40);
          tn.updatedBy = who; tn.updatedAt = at;
          log(`Tenant ${tn.name}: ${tn.status}`);
          b._feed = true;
          break;
        }
        case "review": {
          // Decide one or more To review items: post (with an optional split), mark as transfer, or ignore.
          const items = Array.isArray(b.items) ? b.items : [b];
          let n = 0;
          for (const it of items.slice(0, 500)) {
            const r = (p.review || []).find((x) => x.txId === it.txId);
            if (!r) continue;
            const action = ["post", "ignore", "transfer", "loan"].includes(it.action) ? it.action : "post";
            if (action === "post") {
              const splits = Array.isArray(it.splits) && it.splits.length ? it.splits : [{ category: it.category || r.suggested.category, amount: Math.abs(r.amount), property: b.property }];
              const total = splits.reduce((a, x) => a + Math.abs(num(x.amount) || 0), 0);
              if (Math.abs(total - Math.abs(r.amount)) > 0.011) throw new Error(`The split adds to ${total.toFixed(2)}, not ${Math.abs(r.amount).toFixed(2)}.`);
              for (const sp of splits) {
                const target = data.properties[sp.property || b.property];
                if (!target || target.status !== "active") throw new Error("Pick an active property for each part of the split.");
                const cat = str(sp.category, 60);
                if (!data.categories.some((c) => c.name === cat)) throw new Error(`Unknown category "${sp.category}".`);
                target.entries.push({ id: newId(), date: r.date, category: cat, amount: round2(Math.abs(num(sp.amount))), description: r.name, source: "plaid", txId: r.txId, acct: r.acct,
                  tenantId: cat === "Rent" && it.tenantId ? it.tenantId : undefined, split: splits.length > 1 || undefined, createdBy: who, createdAt: at, updatedBy: who, updatedAt: at });
                target.entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
              }
              if (it.tenantId && splits.some((sp) => sp.category === "Rent")) {
                const tn = (p.tenants || []).find((t) => t.id === it.tenantId);
                if (tn && tn.status === "suggested") { tn.status = "active"; tn.updatedBy = who; tn.updatedAt = at; b._feed = true; }
              }
              if (it.remember && splits.length === 1) { p.rules = p.rules || {}; p.rules[r.key] = { kind: r.amount > 0 ? "income" : "expense", category: splits[0].category, by: who, at }; }
            } else if (it.remember && action === "ignore") { p.rules = p.rules || {}; p.rules[r.key] = { kind: "ignore", by: who, at }; }
            p.decided = p.decided || {};
            p.decided[r.txId] = action === "post" ? "posted" : action;
            p.review = p.review.filter((x) => x.txId !== r.txId);
            n++;
          }
          if (!n) throw new Error("Those items were already handled. Refresh the page.");
          log(`Reviewed ${n} transaction${n === 1 ? "" : "s"}`);
          b._feed = b._feed || items.some((it) => it.remember);
          break;
        }
        case "deleteRule": {
          if (p.rules) delete p.rules[String(b.key || "")];
          log("Payee rule removed");
          break;
        }
        case "deleteLease": {
          const l = (p.leases || []).find((x) => x.id === b.id);
          if (!l) throw new Error("That lease no longer exists.");
          p.leases = p.leases.filter((x) => x.id !== b.id);
          (p.tenants || []).forEach((t) => { if (t.leaseId === b.id) t.leaseId = null; });
          log(`Removed the lease for ${l.tenant || "a tenant"} (the PDF stays in Documents)`);
          break;
        }
        case "updateLease": {
          const l = (p.leases || []).find((x) => x.id === b.id);
          if (!l) throw new Error("That lease no longer exists.");
          Object.assign(l, cleanLease({ ...l, ...(b.lease || {}) }), { updatedBy: who, updatedAt: at });
          log(`Lease for ${l.tenant || "a tenant"} edited`);
          break;
        }
        case "detect":
          b._feed = true;
          log("Ran the Plaid ledger feed");
          break;
        case "_done":
          break;
        default:
          throw new Error("Unknown action.");
      }
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  data.version += 1;
  data.updatedAt = at;
  data.updatedBy = who;
  try { await writeJson(PATH, data); }
  catch (err) { console.error("properties save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  if (b._feed) {
    // New tags, tenants or payee rules: let the Plaid feed re-sort what's waiting.
    try { await runFeeds(await readStore(), await readArchive(), who); return res.status(200).json((await readJson(PATH, null)) || data); }
    catch (e) { console.error("feed after property change", e.message); }
  }
  return res.status(200).json(data);
}
