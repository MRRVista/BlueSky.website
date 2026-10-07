import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";

// Market cap rates for a property, found by Claude with live web search (broker surveys, sales comps, market reports).
// GET  ?property=<id>                       -> last saved search for that property
// POST { property, location?, propertyType?, units?, sqft?, notes? } -> runs a new search and saves it
const API = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages";
const MODEL = () => process.env.CAPRATE_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const path = (pid) => `data/caprates/${pid}.json`;
const s = (v, n = 200) => (v == null ? "" : String(v).slice(0, n).trim());

function prompt(q) {
  return `Find current market capitalization rates for a building like this one, using web search. Today is ${new Date().toISOString().slice(0, 10)}.

Building: ${q.name}
Location: ${q.location || "Chicago suburbs, Illinois (address not entered)"}
Property type: ${q.propertyType || "multifamily"}${q.units ? `, ${q.units} units` : ""}${q.sqft ? `, ${q.sqft} sq ft` : ""}
${q.notes ? `Notes: ${q.notes}\n` : ""}
Look for the most recent (last 12 months preferred) broker cap-rate surveys and market reports (e.g. CBRE, Marcus & Millichap, JLL, Colliers, Berkadia, Newmark, CoStar/LoopNet summaries) and reported sales of comparable buildings in the same submarket or nearby suburbs. Prefer figures specific to the metro and submarket and to the property type and class.

Reply with ONLY a JSON object, no prose, in this shape:
{"low": number, "mid": number, "high": number,
 "summary": "two or three plain sentences on where cap rates sit for this kind of building and why",
 "sources": [{"title": string, "publisher": string, "date": "YYYY-MM or YYYY-MM-DD", "url": string, "capRate": "the figure or range it reports", "scope": "what market/type it covers"}],
 "comps": [{"property": string, "location": string, "date": string, "price": string, "capRate": number, "url": string}]}
Cap rates are percents (6.25 means 6.25%). Include only sources you actually found; 3 to 8 sources. If comps aren't available, return an empty list.`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const pid = s(req.method === "GET" ? req.query.property : (req.body && req.body.property) || "", 40);
  if (req.method === "GET") {
    if (!/^[a-z0-9-]{1,40}$/.test(pid)) return res.status(400).json({ error: "Which property?" });
    return res.status(200).json((await readJson(path(pid), null)) || { none: true });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  const id = s(b.property, 40);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return res.status(400).json({ error: "Which property?" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "The cap-rate search needs ANTHROPIC_API_KEY in this site's Vercel project." });
  const props = await readJson("data/properties.json", null);
  const p = props && props.properties[id];
  const bl = (p && p.building) || {};
  const q = { name: p ? p.name : id, location: s(b.location) || s(bl.address), propertyType: s(b.propertyType, 60) || bl.propertyType, units: Number(b.units) || bl.units, sqft: Number(b.sqft) || bl.squareFeet, notes: s(b.notes, 500) };
  let j;
  try {
    const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }], messages: [{ role: "user", content: prompt(q) }] }) });
    j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || `Anthropic API ${r.status}`);
  } catch (e) {
    console.error("caprate search failed", e);
    return res.status(502).json({ error: `The search didn't finish: ${e.message}. Try again in a minute.` });
  }
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  let out;
  try { out = JSON.parse(m ? m[0] : "{}"); } catch { out = {}; }
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 20 ? Number(v) : null);
  const result = {
    property: id, query: q, searchedAt: new Date().toISOString(), searchedBy: session.email, model: MODEL(),
    low: n(out.low), mid: n(out.mid), high: n(out.high), summary: s(out.summary, 1500),
    sources: (Array.isArray(out.sources) ? out.sources : []).slice(0, 10).map((x) => ({ title: s(x.title), publisher: s(x.publisher, 80), date: s(x.date, 20), url: /^https?:\/\//.test(x.url || "") ? s(x.url, 500) : null, capRate: s(x.capRate, 60), scope: s(x.scope, 200) })),
    comps: (Array.isArray(out.comps) ? out.comps : []).slice(0, 10).map((x) => ({ property: s(x.property), location: s(x.location), date: s(x.date, 20), price: s(x.price, 40), capRate: n(x.capRate), url: /^https?:\/\//.test(x.url || "") ? s(x.url, 500) : null })),
  };
  if (result.mid == null && result.low != null && result.high != null) result.mid = Math.round(((result.low + result.high) / 2) * 100) / 100;
  if (result.mid == null) return res.status(502).json({ error: "The search came back without a usable cap rate. Add the address and property type, then try again.", raw: text.slice(0, 1500) });
  await writeJson(path(id), result);
  return res.status(200).json(result);
}
