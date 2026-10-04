// Indices available for the benchmark proxy. Each is tracked through a liquid ETF so the
// series is total return (dividends reinvested via EODHD adjusted close), net of a small fee.
export const BENCHMARK_CATALOG = [
  { symbol: "SPY", name: "S&P 500", proxy: "SPDR S&P 500 ETF (SPY)", group: "Equity" },
  { symbol: "QQQ", name: "Nasdaq-100", proxy: "Invesco QQQ (QQQ)", group: "Equity" },
  { symbol: "IWM", name: "Russell 2000", proxy: "iShares Russell 2000 (IWM)", group: "Equity" },
  { symbol: "EFA", name: "MSCI EAFE", proxy: "iShares MSCI EAFE (EFA)", group: "Equity" },
  { symbol: "ACWI", name: "MSCI ACWI", proxy: "iShares MSCI ACWI (ACWI)", group: "Equity" },
  { symbol: "AGG", name: "Bloomberg US Aggregate Bond", proxy: "iShares Core US Aggregate Bond (AGG)", group: "Fixed income" },
  { symbol: "LQD", name: "iBoxx USD Liquid Investment Grade", proxy: "iShares iBoxx IG Corporate Bond (LQD)", group: "Fixed income" },
  { symbol: "HYG", name: "iBoxx USD Liquid High Yield", proxy: "iShares iBoxx High Yield Corporate Bond (HYG)", group: "Fixed income" },
  { symbol: "BIL", name: "Bloomberg 1–3 Month T-Bill", proxy: "SPDR Bloomberg 1-3 Month T-Bill (BIL)", group: "Fixed income" },
  { symbol: "PFF", name: "ICE Exchange-Listed Preferred & Hybrid", proxy: "iShares Preferred & Income Securities (PFF)", group: "Income" },
  { symbol: "BIZD", name: "MVIS US Business Development Companies", proxy: "VanEck BDC Income (BIZD)", group: "Income" },
  { symbol: "XYLD", name: "Cboe S&P 500 BuyWrite (BXM)", proxy: "Global X S&P 500 Covered Call (XYLD)", group: "Income" },
  { symbol: "QYLD", name: "Cboe Nasdaq-100 BuyWrite (BXN)", proxy: "Global X Nasdaq 100 Covered Call (QYLD)", group: "Income" },
];

export const DEFAULT_BENCHMARK = {
  components: [{ symbol: "SPY", weight: 60 }, { symbol: "AGG", weight: 40 }],
  leverage: 1,
  borrowRate: 4.75,
};

export const MAX_COMPONENTS = 6;

// Any US-listed ticker is allowed (checked against EODHD when it's typed); the catalog is just suggestions.
export const TICKER_RE = /^[A-Z][A-Z0-9-]{0,9}$/;

// Returns a clean config or throws with a user-facing message.
export function validateBenchmark(input) {
  const comps = (Array.isArray(input && input.components) ? input.components : [])
    .map((c) => {
      const symbol = String(c.symbol || "").trim().toUpperCase().replace(/\.US$/, "");
      const known = BENCHMARK_CATALOG.find((x) => x.symbol === symbol);
      const name = String(c.name || (known && known.name) || symbol).slice(0, 120);
      return { symbol, name, weight: Math.round(Number(c.weight) * 100) / 100 };
    })
    .filter((c) => c.weight > 0);
  if (!comps.length) throw new Error("Pick at least one index with a weight above 0%.");
  if (comps.length > MAX_COMPONENTS) throw new Error(`Use at most ${MAX_COMPONENTS} indices.`);
  if (comps.some((c) => !TICKER_RE.test(c.symbol))) throw new Error("Use US ticker symbols, like SPY or BRK-B.");
  if (new Set(comps.map((c) => c.symbol)).size !== comps.length) throw new Error("Each index can appear only once.");
  if (comps.some((c) => !(c.weight <= 100))) throw new Error("Weights must be between 0% and 100%.");
  const total = comps.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error(`Weights add up to ${total}%; they need to total 100%.`);
  const leverage = Number(input.leverage ?? 1);
  if (!(leverage >= 0.5 && leverage <= 3)) throw new Error("Leverage must be between 0.5× and 3×.");
  const borrowRate = Number(input.borrowRate ?? 0);
  if (!(borrowRate >= 0 && borrowRate <= 20)) throw new Error("Borrowing cost must be between 0% and 20%.");
  return { components: comps, leverage: Math.round(leverage * 100) / 100, borrowRate: Math.round(borrowRate * 100) / 100 };
}
