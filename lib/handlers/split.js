import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { computeSplit, DEFAULT_SETTINGS, SLEEVES, USES } from "../split.js";

// Account Split: the Legacy / 5100 Main attribution and margin tracing.
// GET  ?asOf=YYYY-MM-DD  -> computed split (asOf defaults to the saved date, 9/30/2026 to start)
// POST { version, asOf?, newAccount?, carriedIn?, flows?: { key: { sleeve, use, note, reviewed } } } -> saves, returns recomputed
const PATH = "data/split.json";
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

function cleanFlow(f = {}) {
  const o = {};
  if (f.sleeve in SLEEVES) o.sleeve = f.sleeve;
  if (f.use in USES) o.use = f.use;
  if (typeof f.note === "string" && f.note.trim()) o.note = f.note.trim().slice(0, 300);
  if (f.reviewed) o.reviewed = true;
  return o;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const [p, saved] = await Promise.all([readJson(PORTFOLIO_PATH, null), readJson(PATH, null)]);
  const settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (!p) return res.status(404).json({ error: "No account files have been uploaded yet." });

  if (req.method === "GET") {
    return res.status(200).json(computeSplit(p, settings, { asOf: isoDate(req.query.asOf) }));
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  if (b.version != null && Number(b.version) !== (settings.version || 0)) {
    return res.status(409).json({ error: "Someone else saved changes a moment ago. The latest version is loaded; please redo your change.", data: computeSplit(p, settings) });
  }
  if (b.asOf !== undefined) settings.asOf = isoDate(b.asOf) || DEFAULT_SETTINGS.asOf;
  if (b.newAccount in SLEEVES) settings.newAccount = b.newAccount;
  if (b.carriedIn in USES) settings.carriedIn = b.carriedIn;
  if (b.flows && typeof b.flows === "object") {
    const next = { ...(settings.flows || {}) };
    for (const [k, v] of Object.entries(b.flows).slice(0, 500)) {
      if (!/^\d{4}-\d{2}-\d{2}\|[^|]{1,60}\|-?\d+\.\d{2}\|\d{1,3}$/.test(k)) continue;
      const c = cleanFlow(v);
      if (Object.keys(c).length) next[k] = c; else delete next[k];
    }
    settings.flows = next;
  }
  settings.version = (settings.version || 0) + 1;
  settings.updatedBy = session.email;
  settings.updatedAt = new Date().toISOString();
  try { await writeJson(PATH, settings); }
  catch (err) { console.error("split save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json(computeSplit(p, settings, { asOf: isoDate(b.view) || undefined }));
}
