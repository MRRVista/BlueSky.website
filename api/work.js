// One function serves the workspace endpoints (rewritten from /api/loans, /api/notes, /api/docs, /api/fedfunds, /api/properties).
import loans from "../lib/handlers/loans.js";
import notes from "../lib/handlers/notes.js";
import docs from "../lib/handlers/docs.js";
import fedfunds from "../lib/handlers/fedfunds.js";
import properties from "../lib/handlers/properties.js";

const routes = { loans, notes, docs, fedfunds, properties };

export default async function handler(req, res) {
  const route = routes[req.query.r];
  if (!route) return res.status(404).json({ error: "Not found." });
  return route(req, res);
}
