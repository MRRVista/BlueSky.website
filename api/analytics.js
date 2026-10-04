import { getSession } from "../lib/auth.js";
import { readJson, PORTFOLIO_PATH } from "../lib/store.js";
import { computeAnalytics } from "../lib/analytics.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to view analytics." });
  const portfolio = await readJson(PORTFOLIO_PATH);
  if (!portfolio) return res.status(404).json({ error: "No account files have been uploaded yet." });
  return res.status(200).json(computeAnalytics(portfolio));
}
