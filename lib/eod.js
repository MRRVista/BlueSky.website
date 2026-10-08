// Dividend history from EODHD for the holdings Plaid reports: trailing yield, last dividend,
// ex-dividend and pay dates, and splits. Cached for a day in the private store.
import { readJson, writeJson } from "./store.js";

const BASE = "https://eodhd.com/api";
const CACHE = "data/cache/eod-divs.json";
const sym = (s) => (String(s).includes(".") ? String(s) : `${s}.US`).toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
const isoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// { SYM: { annual, lastDiv, exDiv, payDate, count, perYear } } — annual dividend per share.
export async function dividendInfo(symbols) {
  const token = process.env.EODHD_API_TOKEN;
  const out = {};
  if (!token || !symbols.length) return out;
  const today = isoToday();
  const cache = (await readJson(CACHE, null)) || { date: null, symbols: {} };
  if (cache.date !== today) { cache.date = today; cache.symbols = {}; }
  let changed = false;
  for (const s of [...new Set(symbols)].filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x))) {
    if (cache.symbols[s]) { out[s] = cache.symbols[s]; continue; }
    try {
      const r = await fetch(`${BASE}/div/${encodeURIComponent(sym(s))}?from=${addDays(today, -400)}&fmt=json&api_token=${token}`);
      if (!r.ok) throw new Error(`EODHD ${r.status}`);
      const rows = (await r.json()).filter((d) => d && d.date && Number(d.value) > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
      const yearAgo = addDays(today, -365);
      const inYear = rows.filter((d) => d.date > yearAgo);
      const last = rows[rows.length - 1];
      let annual = inYear.reduce((a, d) => a + Number(d.value), 0);
      // A fund with less than a year of history: annualize from its usual interval.
      if (rows.length >= 2 && rows[0].date > addDays(today, -330)) {
        const gaps = rows.slice(1).map((d, i) => (Date.parse(d.date) - Date.parse(rows[i].date)) / 864e5).sort((a, b) => a - b);
        const gap = gaps[Math.floor(gaps.length / 2)] || 30;
        annual = Number(last.value) * (365 / Math.max(gap, 1));
      }
      const info = { annual: Math.round(annual * 1e6) / 1e6, lastDiv: last ? Number(last.value) : null, exDiv: last ? last.date : null, payDate: last ? last.paymentDate || null : null, count: inYear.length };
      cache.symbols[s] = info; out[s] = info; changed = true;
    } catch (e) { out[s] = { error: e.message }; }
  }
  if (changed) await writeJson(CACHE, cache).catch(() => {});
  return out;
}
