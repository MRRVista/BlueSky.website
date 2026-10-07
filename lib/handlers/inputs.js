import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { INPUTS_PATH, defaultInputs, cleanTax, cleanAccount, cleanProperty, cleanParams, applySeeds, rollup } from "../inputs.js";
import { PARAMS_2026, mergeParams } from "../taxparams.js";
import { computeTaxPlan } from "../taxengine.js";
import { computeAnalytics } from "../analytics.js";
import { getFedFunds } from "../fedfunds.js";

// Inputs page store and the tax plan.
// GET                      -> { inputs, params (effective), baseParams }
// GET ?view=tax[&annualize=1][&year=2026] -> tax plan from the engine
// POST { version, op, ... } -> ops: tax, params, resetParams, account, deleteAccount, property
const PROPS_PATH = "data/properties.json";
const LOANS_PATH = "data/loans.json";
const emptyProperty = (name, status) => ({ name, status, building: {}, mortgage: null, entries: [], trash: [], log: [] });
const defaultProperties = () => ({
  version: 1,
  categories: [{ name: "Rent", type: "income" }, { name: "Property tax", type: "expense" }, { name: "Insurance", type: "expense" }, { name: "Repairs & maintenance", type: "expense" }, { name: "Utilities", type: "expense" }, { name: "Management", type: "expense" }, { name: "Other", type: "expense" }],
  order: ["5100-main", "333-chestnut"],
  properties: { "5100-main": emptyProperty("5100 Main", "active"), "333-chestnut": emptyProperty("333 Chestnut", "coming-soon") },
});

async function load(session) {
  let inputs = (await readJson(INPUTS_PATH, null)) || defaultInputs();
  if (!inputs.seeded) {
    let [props, loans] = await Promise.all([readJson(PROPS_PATH, null), readJson(LOANS_PATH, null)]);
    // The Properties tab only writes its file on the first edit; start from the same default if it isn't there yet.
    if (!props) props = defaultProperties();
    {
      const at = new Date().toISOString();
      const changes = applySeeds(inputs, props, loans, session.email, at);
      if (changes.length) {
        props.version = (props.version || 0) + 1; props.updatedAt = at; props.updatedBy = session.email;
        await writeJson(PROPS_PATH, props);
        inputs.log = [{ at, by: session.email, change: `Starting values: ${changes.join("; ")}` }].concat(inputs.log || []);
      }
      inputs.version = (inputs.version || 0) + 1;
      await writeJson(INPUTS_PATH, inputs);
    }
  }
  return inputs;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const inputs = await load(session);

  if (req.method === "GET") {
    if (req.query.view === "tax") {
      const [p, props, loans, fed] = await Promise.all([readJson(PORTFOLIO_PATH, null), readJson(PROPS_PATH, null), readJson(LOANS_PATH, null), getFedFunds().catch(() => null)]);
      const year = Number(req.query.year) || inputs.tax.year || 2026;
      const plan = computeTaxPlan({ year, tax: inputs.tax, paramsOverride: inputs.params, analytics: p ? computeAnalytics(p) : null, props, inputs,
        adminLoans: loans ? loans.loans : [], fedUpper: fed && fed.upper, annualize: req.query.annualize === "1",
        today: new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) });
      return res.status(200).json(plan);
    }
    return res.status(200).json({ inputs, params: mergeParams(PARAMS_2026, inputs.params || {}), baseParams: PARAMS_2026 });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  if (b.version != null && Number(b.version) !== inputs.version) {
    return res.status(409).json({ error: "Someone else saved a change a moment ago. The latest version is loaded; please redo your change.", data: { inputs, params: mergeParams(PARAMS_2026, inputs.params || {}), baseParams: PARAMS_2026 } });
  }
  const who = session.email, at = new Date().toISOString();
  const log = (change) => { inputs.log = [{ at, by: who, change }].concat(inputs.log || []).slice(0, 500); };
  try {
    switch (b.op) {
      case "tax": {
        const before = inputs.tax, next = cleanTax({ ...before, ...(b.tax || {}) });
        const changed = Object.keys(next).filter((k) => String(next[k]) !== String(before[k]));
        inputs.tax = next;
        log(changed.length ? `Tax profile: ${changed.map((k) => `${k} ${before[k] ?? "—"} → ${next[k] ?? "—"}`).join(", ")}` : "Tax profile saved (no changes)");
        break;
      }
      case "params":
        inputs.params = cleanParams(b.params || {});
        log("Tax-law parameters updated");
        break;
      case "resetParams":
        inputs.params = {};
        log(`Tax-law parameters reset to the ${PARAMS_2026.year} defaults`);
        break;
      case "account": {
        const a = cleanAccount(b.account || {});
        const i = inputs.accounts.findIndex((x) => x.id === a.id);
        if (i >= 0) inputs.accounts[i] = { ...inputs.accounts[i], ...a }; else inputs.accounts.push(a);
        log(`${i >= 0 ? "Updated" : "Added"} account ${a.name}: $${Math.round(a.value).toLocaleString("en-US")}`);
        break;
      }
      case "deleteAccount": {
        const a = inputs.accounts.find((x) => x.id === b.id);
        if (!a) throw new Error("That account no longer exists.");
        inputs.accounts = inputs.accounts.filter((x) => x.id !== b.id);
        log(`Removed account ${a.name}`);
        break;
      }
      case "property": {
        const props = await readJson(PROPS_PATH, null);
        const p = props && props.properties[b.property];
        if (!p) throw new Error("Unknown property.");
        const pi = cleanProperty(b.data || {});
        inputs.properties[b.property] = pi;
        // Keep the building record (read by Overview, Cash Flow and Properties) in step with the detail.
        const ru = rollup(pi), bl = { ...(p.building || {}) };
        if (ru.grossRent != null) bl.grossRent = ru.grossRent;
        if (ru.opexAnnual != null) bl.opexAnnual = Math.round(ru.opexAnnual);
        bl.vacancyPct = pi.vacancyPct;
        bl.landPct = pi.depreciation.landPct;
        if (pi.depreciation.placedInService) bl.placedInService = pi.depreciation.placedInService;
        if (pi.depreciation.costBasis && !(bl.purchasePrice > 0)) bl.purchasePrice = pi.depreciation.costBasis;
        bl.propertyType = pi.depreciation.life === 39 ? "commercial" : "residential";
        if (b.value) {
          const v = b.value;
          if (v.method === "cap" || v.method === "entered") bl.valuationMethod = v.method;
          if (Number(v.currentValue) > 0) { bl.currentValue = Number(v.currentValue); bl.valueAsOf = at.slice(0, 10); }
          if (Number(v.capRate) > 0 && Number(v.capRate) < 30) bl.capRate = Number(v.capRate);
          if (typeof v.address === "string") bl.address = v.address.slice(0, 300).trim() || null;
          if (Number(v.units) > 0) bl.units = Number(v.units);
          if (Number(v.squareFeet) > 0) bl.squareFeet = Number(v.squareFeet);
        }
        bl.updatedBy = who; bl.updatedAt = at;
        p.building = bl;
        p.log = [{ at, by: who, change: "Operating, depreciation and valuation inputs updated (Inputs page)" }].concat(p.log || []).slice(0, 300);
        props.version = (props.version || 0) + 1; props.updatedAt = at; props.updatedBy = who;
        await writeJson(PROPS_PATH, props);
        log(`${p.name}: rent roll (${pi.rentRoll.length} units), expenses, depreciation${b.value ? " and value" : ""} saved`);
        break;
      }
      default:
        throw new Error("Unknown action.");
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  inputs.version = (inputs.version || 0) + 1;
  inputs.updatedAt = at; inputs.updatedBy = who;
  try { await writeJson(INPUTS_PATH, inputs); }
  catch (err) { console.error("inputs save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json({ inputs, params: mergeParams(PARAMS_2026, inputs.params || {}), baseParams: PARAMS_2026 });
}
