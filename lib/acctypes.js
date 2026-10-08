// Balance sheet categories: VistaWealthOffice's data-entry list, plus a margin loan and commercial real estate types.
// [id, label, roll-up bucket]; side comes from the group.
export const ACCOUNT_GROUPS = [
  { g: "Cash", side: "asset", t: [["checking", "Checking", "cash"], ["savings", "Savings / MMA / CDs", "cash"], ["hsa", "HSA", "cash"]] },
  { g: "Public markets", side: "asset", t: [["brokerage", "Brokerage", "taxable"], ["rsu", "Restricted stock / RSU", "taxable"], ["stockopt", "Stock options", "taxable"],
    ["bitcoin", "Bitcoin", "taxable"], ["crypto", "Other crypto", "taxable"], ["gold", "Gold", "taxable"]] },
  { g: "Private markets", side: "asset", t: [["privequity", "Private Equity", "taxable"], ["privcredit", "Private Credit", "taxable"], ["privre", "Private Real Estate", "taxable"],
    ["venture", "Venture Capital", "taxable"], ["infra", "Infrastructure", "taxable"]] },
  { g: "Retirement", side: "asset", t: [["k401", "401(k)", "retirement"], ["k403", "403(b)", "retirement"], ["k457", "457(b)", "retirement"], ["tsp", "TSP", "retirement"],
    ["ira", "Traditional IRA", "retirement"], ["roth", "Roth IRA", "retirement"], ["sep", "SEP IRA", "retirement"], ["simple", "SIMPLE IRA", "retirement"],
    ["pension", "Pension", "retirement"], ["annuity", "Annuity", "retirement"]] },
  { g: "Real assets", side: "asset", t: [["home", "Primary home", "realEstate"], ["reresi", "Residential Real Estate", "realEstate"], ["reoffice", "Office Real Estate", "realEstate"],
    ["remedical", "Medical Office", "realEstate"], ["reretail", "Retail", "realEstate"], ["remixed", "Mixed-use Commercial", "realEstate"],
    ["strental", "VRBO / Airbnb", "realEstate"], ["farmland", "Farmland", "realEstate"], ["ranchland", "Ranchland", "realEstate"],
    ["timberland", "Timberland", "realEstate"], ["oilgas", "Oil and Gas", "realEstate"], ["realestate2", "Other real estate", "realEstate"]] },
  { g: "Other assets", side: "asset", t: [["art", "Art", "otherAssets"], ["collectibles", "Collectibles", "otherAssets"], ["edu529", "529 / Education", "otherAssets"],
    ["vehicle", "Vehicles", "otherAssets"], ["business", "Business interest", "otherAssets"], ["lifecash", "Life ins. cash value", "otherAssets"], ["otherasset", "Other assets", "otherAssets"]] },
  { g: "Charitable", side: "asset", t: [["daf", "Donor Advised Fund", "charitable"], ["foundation", "Foundation", "charitable"], ["charother", "Other Charitable", "charitable"]] },
  { g: "Liabilities", side: "liability", t: [["mortgage", "Mortgage", "mortgage"], ["heloc", "HELOC", "mortgage"], ["margin", "Margin loan", "otherDebt"],
    ["auto", "Auto loan", "otherDebt"], ["cc", "Credit cards", "otherDebt"], ["student", "Student loans", "otherDebt"], ["personal", "Personal / medical debt", "otherDebt"], ["otherdebt", "Other debt", "otherDebt"]] },
];

export const TYPES = {};
ACCOUNT_GROUPS.forEach((g) => g.t.forEach(([id, label, map]) => { TYPES[id] = { id, label, side: g.side, group: g.g, map }; }));
export const isRealAsset = (type) => !!TYPES[type] && TYPES[type].group === "Real assets";
// Real asset types that aren't rentals with a ledger stay off the Properties tab.
export const PROPERTY_TYPES = new Set(["home", "reresi", "reoffice", "remedical", "reretail", "remixed", "strental", "realestate2", "farmland", "ranchland", "timberland", "oilgas"]);
export const COMMERCIAL = new Set(["reoffice", "remedical", "reretail", "remixed"]);

// Uses for a building's mix (percent of rentable space).
export const USE_GROUPS = [
  { g: "Office", t: ["Office", "Medical office", "Flex / R&D"] },
  { g: "Retail", t: ["Retail", "Restaurant / Food service", "Bank branch"] },
  { g: "Residential", t: ["Apartment / Multifamily", "Single-family rental", "Short-term rental"] },
  { g: "Industrial", t: ["Warehouse / Distribution", "Light industrial", "Self-storage"] },
  { g: "Other", t: ["Hospitality", "Parking", "Land", "Mixed-use common area", "Other"] },
];
export const USES = USE_GROUPS.flatMap((g) => g.t);

// Suggested type for a Plaid account.
export function plaidType(a) {
  const t = a.type, s = String(a.subtype || "").toLowerCase(), n = String(a.name || "").toLowerCase();
  if (t === "depository") return s === "hsa" ? "hsa" : s === "checking" || s === "paypal" || s === "prepaid" ? "checking" : "savings";
  if (t === "credit") return "cc";
  if (t === "loan") {
    if (s === "mortgage") return "mortgage";
    if (s === "home equity" || /heloc|home equity/.test(n)) return "heloc";
    if (s === "auto") return "auto";
    if (s === "student") return "student";
    if (/mortgage|real estate|\bre\b|comm re|property|street|main/.test(n)) return "mortgage";
    return "otherdebt";
  }
  if (t === "investment" || t === "brokerage") {
    if (/roth/.test(s)) return "roth";
    if (s === "401k") return "k401";
    if (s === "403b") return "k403";
    if (s === "457b") return "k457";
    if (s === "sep ira") return "sep";
    if (s === "simple ira") return "simple";
    if (/ira|rollover|retirement|keogh|tsp/.test(s)) return s === "thrift savings plan" ? "tsp" : "ira";
    if (s === "hsa") return "hsa";
    if (s === "529" || s === "education savings account") return "edu529";
    if (s === "pension") return "pension";
    if (/annuity/.test(s)) return "annuity";
    if (s === "crypto exchange" || s === "non-custodial wallet") return "crypto";
    return "brokerage";
  }
  return "otherasset";
}
export const plaidSide = (a) => (a.type === "loan" || a.type === "credit" ? "liability" : "asset");
