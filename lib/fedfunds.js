import { readJson, writeJson } from "./store.js";

// Fed Funds target range from the New York Fed's EFFR release (public, no key).
const PATH = "data/fedfunds.json";
const URL_LAST = (n) => `https://markets.newyorkfed.org/api/rates/unsecured/effr/last/${n}.json`;
const STALE_MS = 6 * 3600e3;

async function fetchEffr(n) {
  const r = await fetch(URL_LAST(n), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`NY Fed ${r.status}`);
  const j = await r.json();
  return (j.refRates || []).filter((x) => x.targetRateTo != null).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

// Collapse daily observations into the dates the target range changed.
function changesFrom(rows) {
  const out = [];
  for (const x of rows) {
    const last = out[out.length - 1];
    if (!last || last.upper !== x.targetRateTo || last.lower !== x.targetRateFrom) out.push({ date: x.effectiveDate, lower: x.targetRateFrom, upper: x.targetRateTo });
  }
  return out;
}

export async function getFedFunds({ force = false } = {}) {
  let ff = await readJson(PATH, null);
  const fresh = ff && ff.fetchedAt && Date.now() - Date.parse(ff.fetchedAt) < STALE_MS;
  if (!force && fresh) return ff;
  try {
    const rows = await fetchEffr(ff && ff.history && ff.history.length ? 10 : 600);
    const latest = rows[rows.length - 1];
    if (!latest) throw new Error("no rows");
    const history = ff && ff.history ? [...ff.history] : [];
    for (const c of changesFrom(rows)) {
      const last = history[history.length - 1];
      if (!last || last.upper !== c.upper || last.lower !== c.lower) history.push(c);
    }
    ff = {
      ...(ff || {}),
      lower: latest.targetRateFrom, upper: latest.targetRateTo, effr: latest.percentRate,
      effectiveDate: latest.effectiveDate, fetchedAt: new Date().toISOString(),
      source: "Federal Reserve Bank of New York, effective federal funds rate release",
      history: history.slice(-40), error: null,
    };
    await writeJson(PATH, ff);
  } catch (err) {
    console.error("fed funds refresh failed", err.message);
    if (!ff) return { upper: null, lower: null, error: "The New York Fed feed couldn't be reached.", history: [] };
    ff = { ...ff, error: "Latest refresh failed; showing the last good value." };
  }
  return ff;
}
