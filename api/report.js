import { get } from "@vercel/blob";
import { getSession } from "../lib/auth.js";

// Report data lives in the private Blob store (data/report.json), never in the repo.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to view the report." });
  const blob = await get("data/report.json", { access: "private", useCache: false }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return res.status(404).json({ error: "No report has been uploaded yet." });
  const text = await new Response(blob.stream).text();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).send(text);
}
