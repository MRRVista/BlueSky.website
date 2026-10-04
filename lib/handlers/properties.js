import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { newId } from "../docs.js";

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

const BUILDING_NUM = ["purchasePrice", "currentValue", "squareFeet", "units"];
const BUILDING_TXT = ["address", "purchaseDate", "valueAsOf", "notes"];
function cleanBuilding(b = {}) {
  const o = {};
  for (const k of BUILDING_NUM) if (k in b) o[k] = num(b[k]);
  for (const k of BUILDING_TXT) if (k in b) o[k] = k.endsWith("Date") || k === "valueAsOf" ? isoDate(b[k]) : str(b[k], k === "notes" ? 4000 : 300);
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
      if (p.status !== "active") throw new Error(`${p.name} isn't set up yet.`);
      const log = (change) => { p.log = [{ at, by: who, change }].concat(p.log || []).slice(0, 300); };

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
  return res.status(200).json(data);
}
