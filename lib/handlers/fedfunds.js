import { getSession } from "../auth.js";
import { getFedFunds } from "../fedfunds.js";

// Daily refresh (Vercel Cron) and on-demand reads.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !(await getSession(req))) return res.status(401).json({ error: "Unauthorized" });
  const ff = await getFedFunds({ force: !!cron || req.query.refresh === "1" });
  return res.status(200).json({ upper: ff.upper, lower: ff.lower, effr: ff.effr, effectiveDate: ff.effectiveDate, fetchedAt: ff.fetchedAt, error: ff.error || null });
}
