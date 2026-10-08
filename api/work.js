// One function serves the workspace endpoints (rewritten from /api/loans, /api/notes, /api/docs, /api/fedfunds, /api/properties, /api/ai,
// /api/plan, /api/split, /api/inputs, /api/caprates, /api/plaid, /api/balance, /api/archive, /api/leases) and the daily cron.
import loans from "../lib/handlers/loans.js";
import notes from "../lib/handlers/notes.js";
import docs from "../lib/handlers/docs.js";
import fedfunds from "../lib/handlers/fedfunds.js";
import properties from "../lib/handlers/properties.js";
import ai from "../lib/handlers/ai.js";
import plan from "../lib/handlers/plan.js";
import split from "../lib/handlers/split.js";
import inputs from "../lib/handlers/inputs.js";
import caprates from "../lib/handlers/caprates.js";
import plaid, { dailyPlaid } from "../lib/handlers/plaid.js";
import balance from "../lib/handlers/balance.js";
import archive from "../lib/handlers/archive.js";
import leases from "../lib/handlers/leases.js";
import { getFedFunds } from "../lib/fedfunds.js";

// Daily (Vercel Cron, 8am Central): Fed Funds, then every Plaid connection into the archive and ledgers.
async function daily(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!(process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: "Unauthorized" });
  const out = {};
  try { const ff = await getFedFunds({ force: true }); out.fedfunds = { upper: ff.upper, error: ff.error || null }; } catch (e) { out.fedfunds = { error: e.message }; }
  try { out.plaid = await dailyPlaid(); } catch (e) { out.plaid = { error: e.message }; }
  return res.status(200).json(out);
}

const routes = { loans, notes, docs, fedfunds, properties, ai, plan, split, inputs, caprates, plaid, balance, archive, leases, daily };

export default async function handler(req, res) {
  const route = routes[req.query.r];
  if (!route) return res.status(404).json({ error: "Not found." });
  return route(req, res);
}
