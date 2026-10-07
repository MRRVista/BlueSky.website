// Tax engine: one calendar year of federal and Illinois tax for Jen's household as this site sees it.
// Portfolio income and realized results come from the Schwab data; rentals come from the Inputs page
// (rent roll, expenses, depreciation, cost segregation) and the mortgage schedules; everything else is an input.
// It is a planning estimate, organized like the return (Schedules B, D, E, Forms 4952, 8582, 8960, 8995, IL-1040).
import { MACRS, PARAMS_2026, mergeParams } from "./taxparams.js";
import { rollup } from "./inputs.js";

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
const clamp0 = (n) => Math.max(0, n || 0);

/* ---------- loan interest in a calendar year ---------- */
export function interestInYear(m, year) {
  if (!m || !(m.amount > 0)) return 0;
  const r = (m.rate || 0) / 100 / 12, n = Math.round((m.amortYears || 30) * 12);
  const pmt = m.paymentOverride || (r === 0 ? m.amount / n : (r * m.amount) / (1 - Math.pow(1 + r, -n)));
  const first = m.firstPaymentDate || m.loanDate;
  if (!first) return 0;
  let bal = m.amount, y = +first.slice(0, 4), mo = +first.slice(5, 7), interest = 0;
  for (let k = 0; k < n && bal > 0.005 && y <= year; k++) {
    const i = bal * r;
    if (y === year) interest += i;
    bal -= pmt - i;
    if (++mo > 12) { mo = 1; y++; }
  }
  return interest;
}

/* ---------- depreciation for one building in one year ---------- */
// Building basis = cost basis × (1 − land share). Cost-segregated 5/7/15-year property uses MACRS half-year
// tables plus bonus in the year the study's property is placed in service; the rest is straight-line
// (27.5 or 39 years, mid-month). Illinois adds back bonus and allows the regular MACRS instead.
export function depreciation(dep, year, P) {
  const out = { federal: 0, illinois: 0, straightLine: 0, costSeg: 0, bonus: 0, notes: [] };
  if (!dep || !(dep.costBasis > 0)) { out.notes.push("No cost basis entered"); return out; }
  const bldg = dep.costBasis * (1 - (dep.landPct ?? 20) / 100);
  const cs = dep.costSeg || {};
  const segPct = cs.done ? clamp0(cs.pct5) + clamp0(cs.pct7) + clamp0(cs.pct15) : 0;
  const slBasis = bldg * (1 - Math.min(segPct, 100) / 100);
  const life = dep.life || P.federal.residentialLife;
  const pis = dep.placedInService;
  const pisY = pis ? +pis.slice(0, 4) : null, pisM = pis ? +pis.slice(5, 7) : 1;
  if (!pis || year > pisY) {
    const yearsIn = pis ? year - pisY - 0.5 + (12 - pisM + 0.5) / 12 : 0; // whole years after the first
    out.straightLine = pis && yearsIn > life ? 0 : slBasis / life;
  } else if (year === pisY) out.straightLine = (slBasis / life) * ((12 - pisM + 0.5) / 12);
  if (cs.done && segPct > 0) {
    const csY = cs.year || pisY || year;
    const k = year - csY;
    const bonusPct = (cs.bonusPct ?? P.federal.bonusDepreciation) / 100;
    for (const [cls, pct] of [[5, cs.pct5], [7, cs.pct7], [15, cs.pct15]]) {
      const base = bldg * clamp0(pct) / 100;
      if (!base) continue;
      const bonus = k === 0 ? base * bonusPct : 0;
      const rest = base - base * bonusPct;
      const tbl = MACRS[cls];
      const macrsFed = k >= 0 && k < tbl.length ? rest * tbl[k] / 100 : 0;
      const macrsIl = k >= 0 && k < tbl.length ? base * tbl[k] / 100 : 0;
      out.bonus += bonus; out.costSeg += macrsFed;
      out.illinois += macrsIl;
    }
    if (pisY && csY > pisY) out.notes.push("Cost segregation on a building already in service is shown as if the reclassified property were placed in service in the study year; the actual catch-up runs through Form 3115.");
  }
  out.federal = out.straightLine + out.costSeg + out.bonus;
  out.illinois += out.straightLine;
  return out;
}

function bracketTax(income, brackets) {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i], hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * rate / 100;
  }
  return tax;
}
const marginalRate = (income, brackets) => brackets.filter(([lo]) => income > lo).pop()?.[1] ?? brackets[0][1];

/* ---------- main ---------- */
// ctx: { year, tax (profile), paramsOverride, analytics, props (properties.json), inputs, adminLoans, fedUpper, annualize, today }
export function computeTaxPlan(ctx) {
  const T = ctx.tax, year = ctx.year || T.year || 2026;
  const P = mergeParams(PARAMS_2026, ctx.paramsOverride || {});
  const F = P.federal, IL = P.illinois, fs = T.filingStatus === "mfj" ? "mfj" : "single";
  const notes = [];
  const A = ctx.analytics;

  /* ----- portfolio income for the year ----- */
  const yy = String(year);
  const items = A ? A.income.items.filter((x) => x.d.startsWith(yy)) : [];
  const lastDate = items.length ? items.map((x) => x.d).sort().pop() : null;
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const monthsIn = today.startsWith(yy) ? Math.max(1, +today.slice(5, 7) - 1 + +today.slice(8, 10) / 31) : 12;
  const scale = ctx.annualize && monthsIn < 12 ? 12 / monthsIn : 1;
  if (scale !== 1) notes.push(`Distributions and margin interest are year-to-date through ${lastDate || today} scaled to a full year (×${scale.toFixed(2)}). Realized gains are year-to-date only.`);
  const by = (k) => sum(items.filter((x) => x.k === k), (x) => x.a) * scale;
  const cashDiv = by("Cash dividend (character set on 1099)");
  const roc = cashDiv * (T.rocPct || 0) / 100 + by("Return of capital");
  const cashTaxable = cashDiv * (1 - (T.rocPct || 0) / 100);
  const qualDiv = cashTaxable * (T.cashDivQualifiedPct || 0) / 100 + by("Qualified dividend") + (T.otherQualifiedDividends || 0);
  const nonQual = cashTaxable * (1 - (T.cashDivQualifiedPct || 0) / 100) + by("Non-qualified dividend");
  const subst = by("Substitute payment in lieu");
  const interestInc = by("Interest") + by("Cash in lieu");
  const capGainDist = by("Capital gain distribution");
  const marginInterest = -by("Margin interest");

  /* ----- capital gains (Schedule D) ----- */
  const R = A && A.realized ? A.realized[yy] : null;
  let st = (R ? R.st : 0) - (T.stLossCarryforward || 0);
  let lt = (R ? R.lt : 0) + capGainDist + (T.otherNetCapitalGain || 0) - (T.ltLossCarryforward || 0);
  const netCap = st + lt;
  let prefGain = 0, stGainOrdinary = 0, capLossDeduction = 0, cfST = 0, cfLT = 0;
  if (netCap >= 0) { prefGain = lt > 0 ? Math.min(lt, netCap) : 0; stGainOrdinary = netCap - prefGain; }
  else {
    capLossDeduction = Math.min(F.capitalLossLimit, -netCap);
    let rem = -netCap - capLossDeduction;
    const stLoss = clamp0(-st) - clamp0(lt), ltLoss = clamp0(-lt) - clamp0(st);
    if (stLoss > 0 && ltLoss <= 0) cfST = rem; else if (ltLoss > 0 && stLoss <= 0) cfLT = rem;
    else { const usedST = Math.min(clamp0(-st), capLossDeduction); cfST = clamp0(-st) - usedST; cfLT = rem - cfST; }
  }

  /* ----- rentals (Schedule E) ----- */
  const D = ctx.props, inputs = ctx.inputs || { properties: {} };
  const adminLoans = (ctx.adminLoans || []).filter((l) => (l.status || "open") === "open");
  const rentals = [];
  if (D) for (const pid of D.order || Object.keys(D.properties)) {
    const p = D.properties[pid];
    if (p.status !== "active") continue;
    const pi = inputs.properties[pid];
    if (!pi) continue;
    const ru = rollup(pi), b = p.building || {};
    const rent = ru.grossRent != null ? ru.egi : (b.grossRent || 0) * (1 - (b.vacancyPct || 0) / 100);
    const opex = ru.grossRent != null || ru.opexAnnual ? (ru.opexAnnual || 0) : (b.opexAnnual || 0);
    // mortgage interest: an Admin loan secured by this property wins over the Properties-tab mortgage
    const al = adminLoans.find((l) => l.secures === pid && l.kind !== "margin");
    let mInt = 0, loanSrc = "none";
    if (al) {
      const rate = al.rateType === "floating" ? (ctx.fedUpper ?? 0) + Number(al.spread || 0) : Number(al.fixedRate || 0);
      mInt = al.kind === "interest-only" ? Number(al.originalPrincipal || 0) * rate / 100
        : interestInYear({ amount: Number(al.originalPrincipal || 0), rate, amortYears: Number(al.amortMonths || 360) / 12, firstPaymentDate: al.firstPaymentDate }, year);
      loanSrc = `Admin loan "${al.name}"`;
    } else if (p.mortgage) { mInt = interestInYear(p.mortgage, year); loanSrc = p.mortgage.placeholder ? "placeholder mortgage" : "Properties-tab mortgage"; }
    const invPct = (pi.interestInvestmentPct || 0) / 100;
    const dep = depreciation(pi.depreciation, year, P);
    const rentalInterest = mInt * (1 - invPct), investInterest = mInt * invPct;
    const net = rent - opex - rentalInterest - dep.federal;
    rentals.push({ id: pid, name: p.name, rent, opex, mortgageInterest: mInt, rentalInterest, investInterest, invPct: invPct * 100, loanSrc,
      dep, net, ilAdjust: dep.federal - dep.illinois, ubia: (pi.depreciation.costBasis || 0) * (1 - (pi.depreciation.landPct ?? 20) / 100),
      noRentRoll: !(pi.rentRoll || []).length });
  }
  const rentalNet = sum(rentals, (r) => r.net);

  /* ----- AGI before passive limits ----- */
  const ordinaryBase = nonQual + subst + interestInc + stGainOrdinary + (T.otherOrdinaryIncome || 0) + (T.iraDistributions || 0) - capLossDeduction;
  const magiNoRental = ordinaryBase + qualDiv + prefGain;
  /* ----- passive activity limits (Form 8582) ----- */
  let rentalAllowed = rentalNet, suspended = 0, allowance = null;
  const nonpassive = !!T.reps;
  if (!nonpassive) {
    const passiveTotal = rentalNet - (T.passiveLossCarryforward || 0);
    if (passiveTotal >= 0) rentalAllowed = passiveTotal;
    else {
      allowance = T.activeParticipation ? clamp0(F.passive.allowance - 0.5 * clamp0(magiNoRental - F.passive.phaseStart)) : 0;
      rentalAllowed = -Math.min(-passiveTotal, allowance);
      suspended = -passiveTotal - Math.min(-passiveTotal, allowance);
    }
  }
  const agi = magiNoRental + rentalAllowed;

  /* ----- Illinois (computed first: it feeds the SALT deduction) ----- */
  const ilAddback = IL.bonusAddback ? sum(rentals, (r) => r.ilAdjust) * (rentalNet < 0 && !nonpassive && rentalNet !== 0 ? Math.min(1, Math.abs(rentalAllowed / rentalNet)) : 1) : 0;
  const ilBase = agi + ilAddback;
  const ilExempt = agi <= IL.exemptionIncomeLimit[fs] ? IL.exemption * (fs === "mfj" ? 2 : 1) : 0;
  const ilTax = clamp0(ilBase - ilExempt) * IL.rate / 100;

  /* ----- itemized deductions ----- */
  const invInterestTotal = (T.deductMarginInterest ? marginInterest : 0) + sum(rentals, (r) => r.investInterest) + (T.investmentInterestCarryforward || 0);
  const nii4952 = clamp0(interestInc + nonQual + subst + stGainOrdinary);
  const invInterestDed = Math.min(invInterestTotal, nii4952);
  const invInterestCF = invInterestTotal - invInterestDed;
  const saltCap = Math.max(F.saltCap.floor, F.saltCap.cap - 0.3 * clamp0(agi - F.saltCap.phaseStart));
  const salt = Math.min(saltCap, ilTax + (T.otherStateLocalTax || 0));
  const itemized = salt + invInterestDed + (T.otherItemized || 0);
  const std = F.standardDeduction[fs];
  const deduction = Math.max(itemized, std);
  const itemizing = itemized > std;
  if (!itemizing && invInterestDed > 0) notes.push("The standard deduction is larger than itemizing, so investment interest gives no federal benefit this year (it doesn't carry forward when unused for that reason; only the part above net investment income carries).");

  /* ----- QBI (Form 8995) ----- */
  const tiBeforeQbi = clamp0(agi - deduction);
  let qbi = 0;
  if (T.rentalQbi && rentalAllowed > 0) {
    const base = 0.2 * rentalAllowed;
    const ubiaCap = (F.qbi.ubiaRate / 100) * sum(rentals, (r) => r.ubia);
    const over = clamp0(tiBeforeQbi - F.qbi.threshold[fs]), phase = Math.min(1, over / F.qbi.phaseIn[fs]);
    const limited = base - phase * clamp0(base - ubiaCap);
    qbi = Math.min(limited, 0.2 * clamp0(tiBeforeQbi - qualDiv - prefGain));
  }
  const taxable = clamp0(tiBeforeQbi - qbi);

  /* ----- federal tax ----- */
  const pref = Math.min(taxable, qualDiv + prefGain);
  const ordTaxable = taxable - pref;
  const brackets = F.brackets[fs];
  const ordTax = bracketTax(ordTaxable, brackets);
  const [t0, t1] = F.ltcg[fs];
  const in0 = clamp0(Math.min(pref, t0 - ordTaxable)), in15 = clamp0(Math.min(pref - in0, t1 - Math.max(ordTaxable, t0))), in20 = pref - in0 - in15;
  const prefTax = in15 * 0.15 + in20 * 0.20;
  const fedIncomeTax = ordTax + prefTax;

  /* ----- NIIT (Form 8960) ----- */
  // NII: interest, dividends, net capital gain and passive rental results, less investment interest actually deducted
  const nii = clamp0(interestInc + nonQual + subst + qualDiv + clamp0(netCap) + (!nonpassive ? rentalAllowed : 0) - (itemizing ? invInterestDed : 0));
  const niitBase = T.niit ? Math.min(nii, clamp0(agi - F.niit.threshold[fs])) : 0;
  const niit = niitBase * F.niit.rate / 100;

  const total = fedIncomeTax + niit + ilTax;
  const margOrd = marginalRate(ordTaxable, brackets);
  const margPref = ordTaxable + pref > t1 ? 20 : ordTaxable + pref > t0 ? 15 : 0;
  const overNiit = T.niit && agi > F.niit.threshold[fs];

  /* ----- hypothetical sale of each building ----- */
  const sales = rentals.map((r) => {
    const pi = inputs.properties[r.id], dep = pi.depreciation || {};
    const p = D.properties[r.id], b = p.building || {};
    const price = (pi.sale && pi.sale.price) || b.currentValue || 0;
    const costs = price * ((pi.sale && pi.sale.sellingCostPct) ?? 5) / 100;
    // accumulated depreciation through this year
    let accSL = 0, accSeg = 0;
    const pisY = dep.placedInService ? +dep.placedInService.slice(0, 4) : null;
    if (pisY) for (let y = pisY; y <= year; y++) { const d = depreciation(dep, y, P); accSL += d.straightLine; accSeg += d.costSeg + d.bonus; }
    else { accSL = (dep.priorDepreciation || 0) + r.dep.straightLine; accSeg = r.dep.costSeg + r.dep.bonus; }
    const adjBasis = (dep.costBasis || 0) - accSL - accSeg;
    const gain = price - costs - adjBasis;
    const rec1245 = Math.min(clamp0(gain), accSeg);
    const unrec1250 = Math.min(clamp0(gain - rec1245), accSL);
    const g1231 = clamp0(gain - rec1245 - unrec1250);
    const fedTax = rec1245 * (margOrd / 100) + unrec1250 * Math.min(F.unrecaptured1250Rate, margOrd) / 100 + g1231 * 0.20;
    const niitS = T.niit ? clamp0(gain) * F.niit.rate / 100 : 0;
    const ilS = clamp0(gain) * IL.rate / 100;
    const tax = fedTax + niitS + ilS;
    const payoff = (() => { const m = p.mortgage; if (!m) return null; let bal = m.amount; const rr = (m.rate || 0) / 1200, n = Math.round((m.amortYears || 30) * 12), pmt = (rr * m.amount) / (1 - Math.pow(1 + rr, -n)); const fy = +(m.firstPaymentDate || m.loanDate).slice(0, 4), fm = +(m.firstPaymentDate || m.loanDate).slice(5, 7); const k = Math.max(0, (year - fy) * 12 + 12 - fm + 1); for (let i = 0; i < Math.min(k, n); i++) bal -= pmt - bal * rr; return bal; })();
    const exchange = !!(pi.sale && pi.sale.exchange1031);
    return { id: r.id, name: r.name, price, costs, adjBasis, accSL, accSeg, gain, rec1245, unrec1250, g1231, fedTax, niit: niitS, il: ilS, tax: exchange ? 0 : tax, deferred: exchange ? tax : 0, exchange,
      mortgagePayoff: payoff, netCash: price - costs - (payoff || 0) - (exchange ? 0 : tax), suspendedReleased: suspended && rentals.length ? suspended * (r.net < 0 ? r.net / Math.min(-1e-9, sum(rentals.filter((x) => x.net < 0), (x) => x.net)) : 0) : 0 };
  });

  const rmd = T.birthYear ? { age: year - T.birthYear, startAge: T.birthYear < 1960 ? F.rmdAge.bornBefore1960 : F.rmdAge.born1960OrLater } : null;
  if (rentals.some((r) => r.noRentRoll)) notes.push("Rent and expenses for properties without a rent roll come from the building's pro forma fields; add a rent roll on the Inputs page for unit-level detail.");
  if (rentals.some((r) => r.loanSrc === "placeholder mortgage")) notes.push("Mortgage interest uses placeholder loan terms ($5.0M and $4.5M at 6%, 30 years). Enter the actual terms on the Inputs page.");
  if (cashDiv && !T.rocPct) notes.push("Cash dividends are taxed as ordinary income with no return of capital until the 1099 sets their character; set the ROC and qualified shares on the Inputs page.");

  const R0 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v]));
  return {
    year, filingStatus: fs, scale, params: P, notes,
    income: R0({ cashDiv, roc, qualDiv, nonQual, subst, interest: interestInc, capGainDist, marginInterest, otherOrdinary: T.otherOrdinaryIncome || 0, ira: T.iraDistributions || 0 }),
    capital: R0({ st: R ? R.st : 0, lt: R ? R.lt : 0, stCF: T.stLossCarryforward || 0, ltCF: T.ltLossCarryforward || 0, netST: st, netLT: lt, net: netCap, prefGain, stGainOrdinary, lossDeduction: capLossDeduction, carryST: cfST, carryLT: cfLT }),
    rentals: rentals.map((r) => ({ ...R0({ rent: r.rent, opex: r.opex, mortgageInterest: r.mortgageInterest, rentalInterest: r.rentalInterest, investInterest: r.investInterest, invPct: r.invPct, net: r.net, ilAdjust: r.ilAdjust, ubia: r.ubia }), id: r.id, name: r.name, loanSrc: r.loanSrc, dep: R0({ federal: r.dep.federal, illinois: r.dep.illinois, straightLine: r.dep.straightLine, costSeg: r.dep.costSeg, bonus: r.dep.bonus }), depNotes: r.dep.notes })),
    passive: R0({ nonpassive, net: rentalNet, priorCF: T.passiveLossCarryforward || 0, allowance: allowance == null ? null : allowance, allowed: rentalAllowed, suspended }),
    agi: r2(agi), magiNoRental: r2(magiNoRental),
    deductions: R0({ salt, saltCap, investmentInterest: invInterestDed, investmentInterestTotal: invInterestTotal, investmentInterestCF: invInterestCF, nii4952, other: T.otherItemized || 0, itemized, standard: std, used: deduction, itemizing }),
    qbi: r2(qbi), taxable: r2(taxable), ordinaryTaxable: r2(ordTaxable), preferential: r2(pref),
    federal: R0({ ordinary: ordTax, preferential: prefTax, total: fedIncomeTax, at0: in0, at15: in15, at20: in20 }),
    niit: R0({ nii, base: niitBase, tax: niit }),
    illinois: R0({ base: ilBase, addback: ilAddback, exemption: ilExempt, tax: ilTax }),
    total: r2(total), effective: agi > 0 ? total / agi : null,
    marginal: { ordinary: margOrd, preferential: margPref, niit: overNiit ? F.niit.rate : 0, illinois: IL.rate, combinedOrdinary: margOrd + (overNiit ? F.niit.rate : 0) + IL.rate, combinedLtcg: margPref + (overNiit ? F.niit.rate : 0) + IL.rate },
    carryforwards: R0({ stLoss: cfST, ltLoss: cfLT, passive: suspended, investmentInterest: invInterestCF }),
    sales, rmd,
  };
}
