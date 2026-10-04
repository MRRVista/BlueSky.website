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
      const withPrice = req.query.price === "1";
      if (dates.length < 2) return res.status(400).json({ error: "Need at least two dates." });
      if (dates.length > 400) return res.status(400).json({ error: "Too many dates." });
      const from = new Date(Date.parse(dates[0]) - 10 * 864e5).toISOString().slice(0, 10);
      const to = dates[dates.length - 1];
      const out = {}, price = {};
      for (const s of symbols) {
        const rows = await eod(s, from, to, token);
        const on = (d, k) => { let v = null; for (const r of rows) { if (r.date <= d) v = r[k]; else break; } return v; };
        const base = on(dates[0], "adjusted_close");
        out[s] = dates.map((d) => { const c = on(d, "adjusted_close"); return base && c ? c / base : null; });
        if (withPrice) { const pb = on(dates[0], "close"); price[s] = dates.map((d) => { const c = on(d, "close"); return pb && c ? c / pb : null; }); }
      }
      return res.status(200).json({ connected: true, dates, series: out, ...(withPrice ? { price } : {}) });
    }
    if (kind === "lookup") {
      // Confirms a ticker exists on a US exchange and returns its name.
      const q = String(req.query.symbol || "").trim().toUpperCase().replace(/\.US$/, "");
      if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(q)) return res.status(200).json({ connected: true, found: false });
      const list = await cached(`s|${q}`, TTL.eod, async () => {
        const r = await fetch(`${BASE}/search/${encodeURIComponent(q)}?api_token=${token}&fmt=json&limit=15`);
        if (!r.ok) throw new Error(`EODHD ${r.status}`);
        return r.json();
      });
      const us = new Set(["US", "NYSE", "NASDAQ", "NYSE ARCA", "BATS", "AMEX", "NYSE MKT"]);
      const hit = (Array.isArray(list) ? list : []).find((x) => String(x.Code).toUpperCase() === q && (us.has(String(x.Exchange).toUpperCase()) || String(x.Country) === "USA"));
      if (!hit) return res.status(200).json({ connected: true, found: false });
      return res.status(200).json({ connected: true, found: true, symbol: q, name: hit.Name, type: hit.Type, exchange: hit.Exchange });
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
