// Shared assumptions edited on the Inputs page: tax profile and parameter overrides, accounts held
// outside the main Schwab account (e.g. the IRA), and per-property operating, depreciation and
// interest-tracing detail. Building values and mortgages stay in data/properties.json and loans in
// data/loans.json, so every tab keeps reading one source; the Inputs page edits those through their APIs.

export const INPUTS_PATH = "data/inputs.json";
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, n = 200) => (v == null ? null : String(v).slice(0, n).trim() || null);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const id = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_TAX = {
  year: 2026, filingStatus: "single", birthYear: null,
  otherOrdinaryIncome: 0, otherQualifiedDividends: 0, otherNetCapitalGain: 0, otherItemized: 0, otherStateLocalTax: 0,
  cashDivQualifiedPct: 0, rocPct: 0,
  iraDistributions: 0,
  stLossCarryforward: 0, ltLossCarryforward: 0, investmentInterestCarryforward: 0, passiveLossCarryforward: 0,
  reps: false, activeParticipation: true, rentalQbi: false,
  niit: true, deductMarginInterest: true,
  // Quick marginal rates used by the Performance, Income and Cash Flow tabs.
  marginalOrdinary: 37, marginalQualified: 20, stateRate: 4.95,
};

export const DEFAULT_PROPERTY = {
  rentRoll: [], vacancyPct: 5, rentGrowthPct: 3,
  expenses: { propertyTax: 0, insurance: 0, repairs: 0, utilities: 0, managementPct: 0, reserves: 0, other: 0 },
  expenseGrowthPct: 3, propertyTaxGrowthPct: 3,
  depreciation: { costBasis: null, landPct: 20, placedInService: null, life: 27.5, priorDepreciation: 0,
    costSeg: { done: false, year: null, pct5: 0, pct7: 0, pct15: 0, bonusPct: 100 } },
  interestInvestmentPct: 0, // share of the mortgage traced to investments (refinance cash-out)
  sale: { price: null, sellingCostPct: 5, exchange1031: false },
};

export function defaultInputs() {
  return {
    version: 0, seeded: false, log: [],
    tax: { ...DEFAULT_TAX },
    params: {},
    accounts: [],
    properties: {},
  };
}

/* ---------- cleaning ---------- */
const cleanNumObj = (src = {}, def) => Object.fromEntries(Object.keys(def).map((k) => [k, num(src[k]) ?? def[k]]));

export function cleanTax(t = {}) {
  const o = { ...DEFAULT_TAX };
  for (const [k, v] of Object.entries(DEFAULT_TAX)) {
    if (!(k in t)) continue;
    if (typeof v === "boolean") o[k] = !!t[k];
    else if (k === "filingStatus") o[k] = ["single", "mfj"].includes(t[k]) ? t[k] : "single";
    else o[k] = num(t[k]) ?? (v === null ? null : 0);
  }
  if (o.birthYear != null && !(o.birthYear > 1900 && o.birthYear < 2020)) o.birthYear = null;
  for (const k of ["cashDivQualifiedPct", "rocPct"]) o[k] = Math.min(Math.max(o[k] || 0, 0), 100);
  return o;
}

export function cleanAccount(a = {}) {
  const name = str(a.name, 80);
  if (!name) throw new Error("Name each account.");
  return {
    id: /^[a-z0-9]{6,20}$/.test(a.id || "") ? a.id : id(),
    name, institution: str(a.institution, 60) || "Schwab",
    type: ["ira", "roth", "taxable", "bank", "other"].includes(a.type) ? a.type : "taxable",
    owner: str(a.owner, 60), last4: str(a.last4, 8),
    value: num(a.value) ?? 0, asOf: isoDate(a.asOf), source: a.source === "plaid" ? "plaid" : "manual",
    plaidAccountId: str(a.plaidAccountId, 80), notes: str(a.notes, 500),
  };
}

export function cleanProperty(p = {}) {
  const d = DEFAULT_PROPERTY;
  const rr = (Array.isArray(p.rentRoll) ? p.rentRoll : []).slice(0, 500).map((r) => ({
    id: /^[a-z0-9]{6,20}$/.test(r.id || "") ? r.id : id(),
    unit: str(r.unit, 40) || "", tenant: str(r.tenant, 80), rent: num(r.rent) ?? 0, sqft: num(r.sqft),
    leaseEnd: isoDate(r.leaseEnd), increasePct: num(r.increasePct), vacant: !!r.vacant,
  }));
  const dep = p.depreciation || {}, cs = dep.costSeg || {};
  return {
    rentRoll: rr,
    vacancyPct: num(p.vacancyPct) ?? d.vacancyPct, rentGrowthPct: num(p.rentGrowthPct) ?? d.rentGrowthPct,
    expenses: cleanNumObj(p.expenses, d.expenses),
    expenseGrowthPct: num(p.expenseGrowthPct) ?? d.expenseGrowthPct, propertyTaxGrowthPct: num(p.propertyTaxGrowthPct) ?? d.propertyTaxGrowthPct,
    depreciation: {
      costBasis: num(dep.costBasis), landPct: num(dep.landPct) ?? 20, placedInService: isoDate(dep.placedInService),
      life: [27.5, 39].includes(Number(dep.life)) ? Number(dep.life) : 27.5, priorDepreciation: num(dep.priorDepreciation) ?? 0,
      costSeg: { done: !!cs.done, year: num(cs.year), pct5: num(cs.pct5) ?? 0, pct7: num(cs.pct7) ?? 0, pct15: num(cs.pct15) ?? 0, bonusPct: num(cs.bonusPct) ?? 100 },
    },
    interestInvestmentPct: Math.min(Math.max(num(p.interestInvestmentPct) ?? 0, 0), 100),
    sale: { price: num((p.sale || {}).price), sellingCostPct: num((p.sale || {}).sellingCostPct) ?? 5, exchange1031: !!(p.sale || {}).exchange1031 },
  };
}

// Parameter overrides: only numbers and bracket arrays of [threshold, rate].
export function cleanParams(p = {}, depth = 0) {
  if (depth > 4 || !p || typeof p !== "object") return {};
  const o = {};
  for (const [k, v] of Object.entries(p).slice(0, 80)) {
    if (!/^[a-zA-Z0-9]{1,40}$/.test(k)) continue;
    if (Array.isArray(v)) {
      const rows = v.slice(0, 20).map((r) => (Array.isArray(r) ? r.slice(0, 2).map(num) : num(r)));
      if (rows.every((r) => (Array.isArray(r) ? r.every((x) => x != null) : r != null))) o[k] = rows;
    } else if (typeof v === "object" && v) o[k] = cleanParams(v, depth + 1);
    else if (typeof v === "boolean") o[k] = v;
    else if (num(v) != null) o[k] = num(v);
  }
  return o;
}

/* ---------- property roll-ups (written back to the building record so every tab agrees) ---------- */
export function rollup(pi) {
  const units = pi.rentRoll || [];
  const grossRent = units.reduce((a, u) => a + (u.vacant ? 0 : (u.rent || 0) * 12), 0) || null;
  const e = pi.expenses || {};
  const fixed = (e.propertyTax || 0) + (e.insurance || 0) + (e.repairs || 0) + (e.utilities || 0) + (e.reserves || 0) + (e.other || 0);
  const egi = (grossRent || 0) * (1 - (pi.vacancyPct || 0) / 100);
  const opex = fixed + egi * (e.managementPct || 0) / 100;
  return { grossRent, opexAnnual: opex || null, noi: grossRent ? egi - opex : null, egi };
}

/* ---------- first-run seeds requested 10/7/2026 (placeholders until real terms are on file) ---------- */
export const SEEDS = {
  values: { "5100-main": 8000000, "333-chestnut": 18000000 },
  loans: { "5100-main": 5000000, "333-chestnut": 4500000 },
  rate: 6, amortYears: 30,
  ira: { name: "Jen Lambert Schwab IRA", institution: "Schwab", type: "ira", owner: "Jen Lambert", value: 250000 },
  interestInvestmentPct: { "5100-main": 30.2 }, // $1,509,969 of refinance cash-out ÷ $5,000,000 loan
};

// Applies seeds to properties.json (values, mortgages, Chestnut switched on) without touching anything already entered.
export function applySeeds(inputs, props, loanStore, who, at) {
  const changes = [];
  const loans = (loanStore && loanStore.loans) || [];
  for (const [pid, value] of Object.entries(SEEDS.values)) {
    const p = props && props.properties[pid];
    if (!p) continue;
    if (p.status !== "active") { p.status = "active"; changes.push(`${p.name} switched on`); }
    p.building = p.building || {};
    if (!(p.building.currentValue > 0)) {
      p.building.currentValue = value;
      p.building.valueAsOf = at.slice(0, 10);
      if (!(p.building.capRate > 0) || !p.building.valuationMethod) p.building.valuationMethod = "entered";
      changes.push(`${p.name} value set to $${value.toLocaleString("en-US")}`);
    }
    const adminLoan = loans.some((l) => (l.status || "open") === "open" && l.secures === pid);
    if (!p.mortgage && !adminLoan) {
      const loanDate = pid === "5100-main" ? "2026-03-02" : "2025-11-01"; // Chestnut date unknown: a full year of payments in 2026
      const [y, mo] = loanDate.split("-").map(Number);
      p.mortgage = { amount: SEEDS.loans[pid], rate: SEEDS.rate, amortYears: SEEDS.amortYears, termYears: null, paymentOverride: null, lender: null,
        loanDate, firstPaymentDate: new Date(Date.UTC(y, mo + 1, 1)).toISOString().slice(0, 10),
        notes: "PLACEHOLDER (10/7/2026): replace with the actual loan terms.", placeholder: true, updatedBy: who, updatedAt: at };
      changes.push(`${p.name} placeholder mortgage $${SEEDS.loans[pid].toLocaleString("en-US")} at ${SEEDS.rate}%, ${SEEDS.amortYears} years`);
    }
    p.log = changes.filter((c) => c.startsWith(p.name)).map((change) => ({ at, by: who, change: `${change} (Inputs seed)` })).concat(p.log || []).slice(0, 300);
    inputs.properties[pid] = cleanProperty({ ...(inputs.properties[pid] || {}), interestInvestmentPct: (inputs.properties[pid] || {}).interestInvestmentPct ?? SEEDS.interestInvestmentPct[pid] ?? 0,
      depreciation: { ...((inputs.properties[pid] || {}).depreciation || {}), costBasis: ((inputs.properties[pid] || {}).depreciation || {}).costBasis ?? value } });
  }
  if (!inputs.accounts.some((a) => a.type === "ira")) {
    inputs.accounts.push(cleanAccount({ ...SEEDS.ira, asOf: at.slice(0, 10) }));
    changes.push("Added Jen Lambert Schwab IRA, $250,000");
  }
  inputs.seeded = true;
  return changes;
}
