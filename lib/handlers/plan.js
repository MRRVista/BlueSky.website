import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { newId } from "../docs.js";

// Cash-flow forecaster settings shared by everyone who signs in: assumptions and custom cash flows.
const PATH = "data/plan.json";
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

function cleanAssumptions(a = {}) {
  const o = {};
  for (const [k, v] of Object.entries(a).slice(0, 60)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k)) continue;
    if (typeof v === "boolean") o[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) o[k] = v;
    else if (typeof v === "string") o[k] = v.slice(0, 40);
  }
  return o;
}
const FREQ = ["once", "monthly", "quarterly", "annually"];
const TAX = ["none", "ordinary", "deductible"];
function cleanItem(i = {}) {
  const amount = num(i.amount);
  const start = isoDate(i.start);
  if (!String(i.name || "").trim()) throw new Error("Name each cash flow.");
  if (amount == null || amount === 0) throw new Error(`Enter an amount for "${i.name}".`);
  if (!start) throw new Error(`Enter a start date for "${i.name}".`);
  return {
    id: /^[a-z0-9]{6,40}$/.test(i.id || "") ? i.id : newId(),
    name: String(i.name).trim().slice(0, 120), amount,
    start, end: isoDate(i.end), freq: FREQ.includes(i.freq) ? i.freq : "once",
    growth: num(i.growth) || 0, tax: TAX.includes(i.tax) ? i.tax : "none",
    entity: String(i.entity || "other").slice(0, 40), on: i.on !== false,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const data = (await readJson(PATH, null)) || { version: 0, assumptions: {}, items: [] };
  if (req.method === "GET") return res.status(200).json(data);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  if (b.version != null && Number(b.version) !== data.version) return res.status(409).json({ error: "Someone else saved the plan a moment ago. The latest version is loaded; please redo your change.", data });
  try {
    if (b.assumptions) data.assumptions = cleanAssumptions(b.assumptions);
    if (Array.isArray(b.items)) data.items = b.items.slice(0, 200).map(cleanItem);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  data.version += 1;
  data.updatedBy = session.email;
  data.updatedAt = new Date().toISOString();
  try { await writeJson(PATH, data); }
  catch (err) { console.error("plan save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json(data);
}
