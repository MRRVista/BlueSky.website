// One function serves the workspace endpoints (rewritten from /api/loans, /api/notes, /api/docs, /api/fedfunds, /api/properties, /api/ai, /api/plan).
import loans from "../lib/handlers/loans.js";
import notes from "../lib/handlers/notes.js";
import docs from "../lib/handlers/docs.js";
import fedfunds from "../lib/handlers/fedfunds.js";
import properties from "../lib/handlers/properties.js";
import ai from "../lib/handlers/ai.js";
import plan from "../lib/handlers/plan.js";

const routes = { loans, notes, docs, fedfunds, properties, ai, plan };

export default async function handler(req, res) {
  const route = routes[req.query.r];
  if (!route) return res.status(404).json({ error: "Not found." });
  return route(req, res);
}
