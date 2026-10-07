// Tax-law parameters for the tax engine. Every value here can be overridden on the Inputs page
// (stored in data/inputs.json under params); these are the starting points, with sources.
// Federal: Rev. Proc. 2025-32 (2026 inflation adjustments) and P.L. 119-21 (One Big Beautiful Bill Act).
// Illinois: 35 ILCS 5 and the Comptroller's 2026 exemption bulletin.

export const PARAMS_2026 = {
  year: 2026,
  asOf: "2026-10-07",
  federal: {
    // Ordinary brackets: [threshold, rate]; income above each threshold is taxed at that rate.
    brackets: {
      single: [[0, 10], [12400, 12], [50400, 22], [105700, 24], [201775, 32], [256225, 35], [640600, 37]],
      mfj: [[0, 10], [24800, 12], [100800, 22], [211400, 24], [403550, 32], [512450, 35], [768700, 37]],
    },
    // Long-term gains / qualified dividends: 0% up to the first number, 15% to the second, 20% above.
    ltcg: { single: [49450, 545500], mfj: [98900, 613700] },
    standardDeduction: { single: 16100, mfj: 32200 },
    niit: { rate: 3.8, threshold: { single: 200000, mfj: 250000 } }, // not indexed
    capitalLossLimit: 3000, // per year against ordinary income ($1,500 MFS)
    unrecaptured1250Rate: 25,
    saltCap: { cap: 40400, phaseStart: 505000, floor: 10000 }, // 2026; reduced 30% of MAGI over the start, not below the floor
    passive: { allowance: 25000, phaseStart: 100000, phaseEnd: 150000 }, // active-participation rental allowance (not indexed)
    qbi: { rate: 20, threshold: { single: 201775, mfj: 403550 }, phaseIn: { single: 75000, mfj: 150000 }, ubiaRate: 2.5, minDeduction: 400 },
    bonusDepreciation: 100, // % for property acquired and placed in service after 1/19/2025 (made permanent by P.L. 119-21)
    section179: { limit: 2500000, phaseStart: 4000000 },
    residentialLife: 27.5,
    commercialLife: 39,
    rmdAge: { bornBefore1960: 73, born1960OrLater: 75 },
  },
  illinois: {
    rate: 4.95,
    exemption: 2925, // per person, 2026
    exemptionIncomeLimit: { single: 250000, mfj: 500000 }, // no exemption above these federal AGIs
    bonusAddback: true, // Illinois decouples from federal bonus depreciation (Form IL-4562)
    investmentInterestDeductible: false, // Illinois starts from federal AGI; itemized deductions don't carry over
  },
  sources: [
    { label: "2026 brackets, standard deduction, capital gains thresholds (Rev. Proc. 2025-32)", url: "https://kpmg.com/us/en/taxnewsflash/news/2025/10/tnf-rev-proc-2025-32-inflation-adjustments-for-2026-individual-taxpayers.html" },
    { label: "OBBBA: permanent 100% bonus, SALT cap $40,400 for 2026, QBI permanent", url: "https://www.thomsonreuters.com/en-us/posts/tax-and-accounting/obbba-faq" },
    { label: "Long-term capital gains thresholds and NIIT thresholds, 2026", url: "https://www.tiaa.org/public/pdf/quick_tax_reference_guide.pdf" },
    { label: "Illinois 2026 exemption $2,925 and 4.95% rate", url: "https://illinoiscomptroller.gov/__media/sites/comptroller/assets/File/PayrollBulletins/Payroll%20Bulletin%201-26%20-%20Illinois%20State%20Income%20Tax%20Exemptions%20-%202026.pdf" },
    { label: "Illinois bonus depreciation addition and subtraction (IL-4562 instructions)", url: "https://tax.illinois.gov/forms/incometax/currentyear/il-4562-instr.html" },
  ],
};

// MACRS (half-year convention) percentages by recovery year. 5 and 7 year are 200% declining balance; 15 year is 150%.
export const MACRS = {
  5: [20, 32, 19.2, 11.52, 11.52, 5.76],
  7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  15: [5, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
};

// Deep merge for parameter overrides (arrays replace whole).
export function mergeParams(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" && !Array.isArray(base[k])) out[k] = mergeParams(base[k], v);
    else if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}
