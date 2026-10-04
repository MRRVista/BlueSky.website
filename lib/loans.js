// Loan math. Rates are in percent (5.95 = 5.95%).
const DAY = 864e5;
const t = (d) => Date.parse(d + "T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
function addMonths(d, n) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m + n, Math.min(day, last)));
}
export const payment = (principal, annualPct, months) => {
  const r = annualPct / 100 / 12;
  if (!months) return 0;
  return r === 0 ? principal / months : (r * principal) / (1 - Math.pow(1 + r, -months));
};
const balanceAfter = (principal, annualPct, pmt, k) => {
  const r = annualPct / 100 / 12;
  if (r === 0) return principal - pmt * k;
  return principal * Math.pow(1 + r, k) - (pmt * (Math.pow(1 + r, k) - 1)) / r;
};

export function currentRate(loan, fed) {
  if (loan.rateType === "floating") {
    const base = fed && fed.upper != null ? fed.upper : null;
    return base == null ? null : base + Number(loan.spread || 0);
  }
  return Number(loan.fixedRate || 0);
}

export function computeLoan(loan, { today, fed, marginBalance }) {
  const rate = currentRate(loan, fed);
  const out = { id: loan.id, rate, status: loan.status || "open", kind: loan.kind };
  if (rate == null) return { ...out, error: "Fed Funds rate unavailable" };

  if (loan.kind === "amortizing") {
    const months = Number(loan.amortMonths || 0);
    const orig = Number(loan.originalPrincipal || 0);
    const pmt = Number(loan.paymentOverride) || payment(orig, rate, months);
    // Payments made = scheduled payment dates on or before today
    let paid = 0;
    if (loan.firstPaymentDate) while (paid < months && addMonths(loan.firstPaymentDate, paid) <= today) paid++;
    let balance = balanceAfter(orig, rate, pmt, paid);
    let basis = "schedule";
    if (loan.balanceOverride && loan.balanceOverride.value != null) {
      // Roll an entered balance forward by any payments scheduled after its date.
      const ov = loan.balanceOverride;
      let after = 0;
      while (paid - after > 0 && addMonths(loan.firstPaymentDate, paid - after - 1) > ov.asOf) after++;
      balance = balanceAfter(Number(ov.value), rate, pmt, after);
      basis = after ? `entered ${ov.asOf}, rolled forward ${after} payment${after > 1 ? "s" : ""}` : `entered ${ov.asOf}`;
    }
    let toMaturity = 0;
    if (loan.maturityDate && loan.firstPaymentDate) while (addMonths(loan.firstPaymentDate, paid + toMaturity) <= loan.maturityDate) toMaturity++;
    const balloon = loan.maturityDate ? Math.max(balanceAfter(balance, rate, pmt, toMaturity), 0) : 0;
    let interest12 = 0, b = balance;
    for (let i = 0; i < Math.min(12, toMaturity || 12); i++) { const int = (b * rate) / 100 / 12; interest12 += int; b -= pmt - int; }
    return { ...out, balance: round2(balance), balanceBasis: basis, payment: round2(pmt), escrow: round2(Number(loan.escrowMonthly || 0)),
      monthlyService: round2(pmt + Number(loan.escrowMonthly || 0)), paymentsMade: paid, paymentsToMaturity: toMaturity,
      nextPayment: loan.firstPaymentDate && paid < months ? addMonths(loan.firstPaymentDate, paid) : null,
      balloon: round2(balloon), annualInterest: round2(interest12), monthlyInterest: round2((balance * rate) / 100 / 12) };
  }

  // Margin, interest-only and credit lines: interest on the outstanding balance.
  let balance = Number(loan.balanceOverride && loan.balanceOverride.value) || 0;
  let basis = loan.balanceOverride ? `entered ${loan.balanceOverride.asOf}` : "not set";
  if (loan.kind === "margin" && loan.autoBalance && marginBalance && marginBalance.value != null) {
    balance = marginBalance.value;
    basis = `Schwab positions ${marginBalance.asOf}`;
  }
  const dayBasis = loan.kind === "margin" ? 360 : 365; // Schwab accrues margin interest on a 360-day year
  const annual = (balance * rate) / 100 * (365 / dayBasis);
  return { ...out, balance: round2(balance), balanceBasis: basis, annualInterest: round2(annual), monthlyInterest: round2(annual / 12),
    monthlyService: round2(annual / 12), dailyInterest: round2((balance * rate) / 100 / dayBasis), dayBasis,
    per25bp: round2((balance * 0.25) / 100 * (365 / dayBasis)) };
}

export function computeAll(loans, ctx) {
  const rows = loans.map((l) => ({ loan: l, calc: computeLoan(l, ctx) }));
  const open = rows.filter((r) => (r.loan.status || "open") === "open" && r.calc.balance != null);
  const total = open.reduce((a, r) => a + (r.calc.balance || 0), 0);
  const wRate = total ? open.reduce((a, r) => a + (r.calc.balance || 0) * (r.calc.rate || 0), 0) / total : null;
  const floating = open.filter((r) => r.loan.rateType === "floating");
  const scenarios = [-0.5, -0.25, 0, 0.25, 0.5].map((shift) => {
    const shifted = ctx.fed && ctx.fed.upper != null ? { ...ctx.fed, upper: ctx.fed.upper + shift } : ctx.fed;
    const annual = open.reduce((a, r) => a + (r.loan.rateType === "floating" ? computeLoan(r.loan, { ...ctx, fed: shifted }).annualInterest : r.calc.annualInterest) || 0, 0);
    return { shift, fedUpper: shifted && shifted.upper, annualInterest: round2(annual), floatingRates: floating.map((r) => ({ id: r.loan.id, rate: currentRate(r.loan, shifted) })) };
  });
  return {
    rows,
    totals: {
      balance: round2(total), weightedRate: wRate, count: open.length,
      annualInterest: round2(open.reduce((a, r) => a + (r.calc.annualInterest || 0), 0)),
      monthlyService: round2(open.reduce((a, r) => a + (r.calc.monthlyService || 0), 0)),
      floatingBalance: round2(floating.reduce((a, r) => a + (r.calc.balance || 0), 0)),
    },
    scenarios,
  };
}
