// Property ledgers fed from Plaid: transactions in each property's tagged bank accounts (and any
// transaction someone tags to the property) become rent, expenses, transfers or loan payments.
// Rent is found by looking for deposits from the same payer, month after month, at the same or nearly
// the same amount. Known payees post automatically; anything new waits in the property's To review list.

export const EXTRA_CATEGORIES = [
  { name: "Other income", type: "income" }, { name: "CAM reimbursements", type: "income" },
  { name: "Landscaping & snow", type: "expense" }, { name: "Janitorial", type: "expense" }, { name: "Legal & professional", type: "expense" },
  { name: "Capital improvements", type: "expense" }, { name: "Tenant improvements", type: "expense" }, { name: "Leasing commissions", type: "expense" },
];
export function ensureCategories(data) {
  let added = false;
  for (const c of EXTRA_CATEGORIES) if (!data.categories.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) { data.categories.push(c); added = true; }
  return added;
}

const STOP = /\b(ach|deposit|dep|credit|debit|ppd|ccd|web|tel|id|ref|reference|mobile|online|electronic|banking|transfer|xfer|from|to|pmt|payment|payments|pymt|trn|trace|des|indn|co|entry|descr|orig|sec|eff|date|ck|check|chk|pos|purchase|recurring|bill|pay|inc|llc|corp|ltd|the|rent|acct|account|ppd|ach)\b/g;
export function payerKey(t) {
  const raw = String(t.merchant || t.name || "").toLowerCase();
  let s = raw.replace(/zelle\s+(payment\s+)?(from|to)\s+/g, "zelle ").replace(/[#*:\/\\]+/g, " ").replace(/\b[\w-]*\d[\w-]*\b/g, " ").replace(STOP, " ").replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").slice(0, 4).join(" ") || raw.slice(0, 30);
}
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const ym = (d) => d.slice(0, 7);
const ymNext = (m) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

const RULES = [
  [/treasurer|tax collector|collector of|property tax|county (of|collector|treasurer)|real estate tax|re tax/i, "Property tax", "county treasurer / property tax payee"],
  [/insurance|insur|state farm|allstate|travelers|liberty mutual|\bcna\b|hartford|chubb|erie|cincinnati fin|zurich/i, "Insurance", "insurance carrier"],
  [/landscap|lawn|snow|plow|tree service|irrigation/i, "Landscaping & snow", "grounds vendor"],
  [/janitor|cleaning|custodial|maid|clean/i, "Janitorial", "cleaning vendor"],
  [/attorney|law (office|group|firm)|legal|\bcpa\b|accounting|accountant|\besq\b/i, "Legal & professional", "professional services"],
  [/management|property mgmt|\bmgmt\b|realty/i, "Management", "management company"],
  [/comed|nicor|peoples gas|water|sewer|waste|republic services|\bgfl\b|electric co|ameren|xfinity|comcast|at&t|verizon|utility/i, "Utilities", "utility"],
  [/hvac|heating|cooling|plumb|electrical|roof|repair|maintenance|elevator|fire protection|alarm|locksmith|paint|glass|door|home depot|lowe'?s|menards|grainger/i, "Repairs & maintenance", "repair or supply vendor"],
];
const PFC = {
  GOVERNMENT_AND_NON_PROFIT: "Property tax", RENT_AND_UTILITIES: "Utilities", HOME_IMPROVEMENT: "Repairs & maintenance", BANK_FEES: "Other",
};

function suggestExpense(t) {
  const n = `${t.merchant || ""} ${t.name || ""}`;
  for (const [re, cat, why] of RULES) if (re.test(n)) return { category: cat, reason: why };
  if (t.pfcd === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT") return { category: "Property tax", reason: "tax payment" };
  if (t.pfcd === "GENERAL_SERVICES_INSURANCE") return { category: "Insurance", reason: "insurance (Plaid category)" };
  if (t.pfc && PFC[t.pfc]) return { category: PFC[t.pfc], reason: `Plaid category ${t.pfc.toLowerCase().replace(/_/g, " ")}` };
  return { category: "Other", reason: "new payee" };
}

// Money moving between two of the family's own connected accounts.
function transferIndex(all) {
  const byAmt = {};
  for (const t of all) if (t.kind === "bank" && !t.removed && !t.pending) { const k = Math.round(Math.abs(t.amount) * 100); (byAmt[k] = byAmt[k] || []).push(t); }
  return (t) => {
    if (t.pfcd && /ACCOUNT_TRANSFER$/.test(t.pfcd)) return true;
    const list = byAmt[Math.round(Math.abs(t.amount) * 100)] || [];
    return list.some((o) => o.id !== t.id && o.acct !== t.acct && Math.sign(o.amount) === -Math.sign(t.amount) && Math.abs(Date.parse(o.date) - Date.parse(t.date)) <= 3 * 864e5);
  };
}
const isLoanPayment = (t, lenders) => t.amount > 0 && (t.pfc === "LOAN_PAYMENTS" || /loan (pmt|payment)|mortgage|ln pmt|loan pay/i.test(`${t.name} ${t.merchant || ""}`) || lenders.some((l) => l && new RegExp(l.split(" ")[0], "i").test(`${t.name} ${t.merchant || ""}`) && /loan|pmt|payment/i.test(t.name)));

// Recurring deposits from one payer: at least 3 consecutive months within 3% of each other (or exact repeats).
export function detectTenants(txns, { tolerance = 0.03, minMonths = 3 } = {}) {
  const groups = {};
  for (const t of txns) if (t.amount < 0) { const k = payerKey(t); (groups[k] = groups[k] || []).push(t); }
  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const byMonth = {};
    list.forEach((t) => { byMonth[ym(t.date)] = (byMonth[ym(t.date)] || 0) + -t.amount; });
    const months = Object.keys(byMonth).sort();
    // longest run of consecutive months whose amounts all sit within the tolerance of the run's median
    let best = [];
    const fits = (run) => { const m = median(run.map((x) => byMonth[x])); return run.every((x) => Math.abs(byMonth[x] - m) <= Math.max(tolerance * m, 0.01)); };
    for (let i = 0; i < months.length; i++) {
      const run = [months[i]];
      for (let j = i + 1; j < months.length && months[j] === ymNext(run[run.length - 1]); j++) {
        if (!fits(run.concat([months[j]]))) break;
        run.push(months[j]);
      }
      if (run.length > best.length) best = run;
    }
    if (best.length < minMonths) continue;
    const last3 = best.slice(-3).map((x) => byMonth[x]);
    const sample = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out.push({ key, name: titleCase(key.replace(/^zelle /, "")), expected: round2(median(last3)), months: best.length, firstSeen: best[0], lastSeen: best[best.length - 1],
      sampleName: sample.name, txIds: list.filter((t) => best.includes(ym(t.date))).map((t) => t.id), day: Math.round(median(list.map((t) => +t.date.slice(8, 10)))) });
  }
  return out.sort((a, b) => b.expected - a.expected);
}

// Run the feed for every active property. Mutates `data` (properties.json). Returns a summary per property.
export function runPropertyFeed(data, archive, plaidStore, { lendersByProp = {}, who = "Plaid", at = new Date().toISOString(), newId }) {
  ensureCategories(data);
  const all = Object.values(archive.txns || {});
  const isTransfer = transferIndex(all);
  const summary = {};
  for (const pid of data.order || Object.keys(data.properties)) {
    const p = data.properties[pid];
    if (!p || p.status !== "active") continue;
    p.accounts = p.accounts || []; p.tenants = p.tenants || []; p.rules = p.rules || {}; p.review = p.review || []; p.decided = p.decided || {};
    const accts = new Set(p.accounts);
    const mine = all.filter((t) => t.kind === "bank" && !t.removed && !t.pending && ((accts.has(t.acct) && !(t.u && t.u.propertyId && t.u.propertyId !== pid)) || (t.u && t.u.propertyId === pid)));
    if (!mine.length && !p.accounts.length) continue;
    const s = { posted: 0, review: 0, transfers: 0, loans: 0, suggestions: 0 };
    // tenant suggestions from the deposits
    const rejected = new Set(p.tenants.filter((x) => x.status === "rejected").flatMap((x) => x.keys));
    const known = new Set(p.tenants.flatMap((x) => x.keys));
    const deposits = mine.filter((t) => t.amount < 0 && !isTransfer(t));
    for (const c of detectTenants(deposits)) {
      if (known.has(c.key) || rejected.has(c.key)) {
        const tn = p.tenants.find((x) => x.keys.includes(c.key));
        if (tn && tn.status === "suggested") Object.assign(tn, { expected: c.expected, months: c.months, firstSeen: c.firstSeen, lastSeen: c.lastSeen, day: c.day });
        continue;
      }
      p.tenants.push({ id: newId(), name: c.name, keys: [c.key], expected: c.expected, months: c.months, firstSeen: c.firstSeen, lastSeen: c.lastSeen, day: c.day, sampleName: c.sampleName,
        status: "suggested", source: "detected", alertDay: 10, createdAt: at });
      s.suggestions++;
    }
    const tenantFor = (t) => p.tenants.find((x) => x.status === "active" && x.keys.includes(payerKey(t)));
    const suggestedFor = (t) => p.tenants.find((x) => x.status === "suggested" && x.keys.includes(payerKey(t)));
    const lenders = lendersByProp[pid] || [];
    // Review items whose transaction is gone (Plaid removed it, or it moved to a reconnected id) drop off.
    const live = new Set(mine.map((t) => t.id));
    p.review = p.review.filter((r) => live.has(r.txId));
    // Waiting deposits from a payer now recognized as a possible tenant get that suggestion.
    for (const r of p.review) if (r.amount > 0 && r.suggested && r.suggested.category !== "Rent") {
      const sg = p.tenants.find((x) => x.status === "suggested" && x.keys.includes(r.key));
      if (sg) r.suggested = { category: "Rent", reason: `matches suggested tenant ${sg.name}`, tenantId: sg.id };
    }
    const reviewIds = new Set(p.review.map((r) => r.txId));
    for (const t of mine.sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (p.decided[t.id]) continue;
      const amt = -t.amount; // + money in, − money out
      const post = (category, extra = {}) => {
        p.entries.push({ id: newId(), date: t.date, category, amount: round2(Math.abs(amt)), description: (t.merchant || t.name || "").slice(0, 300), source: "plaid", txId: t.id, acct: t.acct, ...extra,
          createdBy: who, createdAt: at, updatedBy: who, updatedAt: at });
        p.decided[t.id] = "posted"; s.posted++;
        p.review = p.review.filter((r) => r.txId !== t.id);
      };
      if (t.u && t.u.category) { // someone set a category on the Transactions tab
        if (t.u.category === "Transfer") { p.decided[t.id] = "transfer"; s.transfers++; continue; }
        if (data.categories.some((c) => c.name === t.u.category)) { post(t.u.category); continue; }
      }
      if (amt > 0 && tenantFor(t)) { post("Rent", { tenantId: tenantFor(t).id }); continue; } // a known tenant's deposit is rent even if an equal transfer happened nearby
      if (isTransfer(t)) { p.decided[t.id] = "transfer"; s.transfers++; p.review = p.review.filter((r) => r.txId !== t.id); continue; }
      if (amt < 0 && isLoanPayment(t, lenders)) { p.decided[t.id] = "loan"; s.loans++; p.review = p.review.filter((r) => r.txId !== t.id); continue; }
      const key = payerKey(t);
      if (amt > 0) {
        const tn = tenantFor(t);
        if (tn) { post("Rent", { tenantId: tn.id }); continue; }
        const rule = p.rules[key];
        if (rule && rule.kind !== "review") { if (rule.kind === "ignore") { p.decided[t.id] = "ignored"; continue; } post(rule.category); continue; }
        if (reviewIds.has(t.id)) continue;
        const sg = suggestedFor(t);
        p.review.push({ txId: t.id, date: t.date, amount: round2(amt), name: (t.merchant || t.name || "").slice(0, 200), acct: t.acct, key,
          suggested: sg ? { category: "Rent", reason: `matches suggested tenant ${sg.name}`, tenantId: sg.id } : { category: "Other income", reason: "one-off deposit" } });
        s.review++;
      } else {
        const rule = p.rules[key];
        if (rule && rule.kind !== "review") { if (rule.kind === "ignore") { p.decided[t.id] = "ignored"; continue; } post(rule.category); continue; }
        if (reviewIds.has(t.id)) continue;
        p.review.push({ txId: t.id, date: t.date, amount: round2(amt), name: (t.merchant || t.name || "").slice(0, 200), acct: t.acct, key, suggested: suggestExpense(t) });
        s.review++;
      }
    }
    p.entries.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    p.review.sort((x, y) => (x.date < y.date ? 1 : -1));
    summary[pid] = s;
  }
  return summary;
}
