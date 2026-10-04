import { getSession } from "../lib/auth.js";

// Market data from EODHD. Needs the EODHD_API_TOKEN environment variable on this Vercel project.
const BASE = "https://eodhd.com/api";
const cache = new Map(); // warm-instance cache
const TTL = { eod: 6 * 3600e3, quote: 60e3 };

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const sym = (s) => (String(s).includes(".") ? String(s) : `${s}.US`).toUpperCase().replace(/[^A-Z0-9.\-]/g, "");

async function eod(symbol, from, to, token) {
  const url = `${BASE}/eod/${encodeURIComponent(symbol)}?from=${from}&to=${to}&period=d&fmt=json&api_token=${token}`;
  return cached(`eod|${symbol}|${from}|${to}`, TTL.eod, async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`EODHD ${r.status} for ${symbol}`);
    return r.json();
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, max-age=60");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const token = process.env.EODHD_API_TOKEN;
  if (!token) return res.status(200).json({ connected: false });

  const kind = req.query.kind;
  try {
    if (kind === "benchmarks") {
      // Total-return (adjusted close) growth at each requested date.
      const dates = String(req.query.dates || "").split(",").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      const symbols = String(req.query.symbols || "SPY,HYG,AGG").split(",").slice(0, 6).map(sym);
      if (dates.length < 2) return res.status(400).json({ error: "Need at least two dates." });
      const from = new Date(Date.parse(dates[0]) - 10 * 864e5).toISOString().slice(0, 10);
      const to = dates[dates.length - 1];
      const out = {};
      for (const s of symbols) {
        const rows = await eod(s, from, to, token);
        const closeOn = (d) => { let v = null; for (const r of rows) { if (r.date <= d) v = r.adjusted_close; else break; } return v; };
        const base = closeOn(dates[0]);
        out[s] = dates.map((d) => { const c = closeOn(d); return base && c ? c / base : null; });
      }
      return res.status(200).json({ connected: true, dates, series: out });
    }
    if (kind === "quotes") {
      const symbols = String(req.query.symbols || "").split(",").filter(Boolean).slice(0, 15).map(sym);
      if (!symbols.length) return res.status(400).json({ error: "No symbols." });
      const [first, ...rest] = symbols;
      const url = `${BASE}/real-time/${first}?${rest.length ? `s=${rest.join(",")}&` : ""}fmt=json&api_token=${token}`;
      const data = await cached(`q|${symbols.join(",")}`, TTL.quote, async () => { const r = await fetch(url); if (!r.ok) throw new Error(`EODHD ${r.status}`); return r.json(); });
      const list = Array.isArray(data) ? data : [data];
      return res.status(200).json({ connected: true, quotes: list.map((q) => ({ symbol: String(q.code || "").replace(/\.US$/, ""), price: Number(q.close), previousClose: Number(q.previousClose), changePct: Number(q.change_p), timestamp: q.timestamp })) });
    }
    return res.status(400).json({ error: "Unknown request." });
  } catch (err) {
    console.error("market data failed", err.message);
    return res.status(502).json({ connected: true, error: "Market data is unavailable right now." });
  }
}
