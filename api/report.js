import { get, put } from "@vercel/blob";
import { getSession, readJson as readBody, sameOrigin } from "../lib/auth.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const REPORT_PATH = "data/report.json";

// Basic shape check so a bad upload can't break the signed-in home page.
function validReport(r) {
  if (!r || typeof r !== "object" || !Array.isArray(r.sheets) || !r.sheets.length || r.sheets.length > 60) return false;
  return r.sheets.every((s) => s && typeof s.name === "string" && typeof s.slug === "string" && Number.isInteger(s.cols) && s.cols > 0 && s.cols < 200
    && Array.isArray(s.widths) && Array.isArray(s.rows) && s.rows.length < 5000
    && s.rows.every((row) => Array.isArray(row) && row.every((c) => c && Number.isInteger(c.c) && typeof c.t === "string")));
}

// Report data lives in the private Blob store (data/report.json), never in the repo.
// GET returns it; POST (signed in) replaces it with a workbook read on the Upload page, keeping the old one in data/report-history/.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to view the report." });

  if (req.method === "POST") {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
    const body = await readBody(req);
    const r = body && body.report;
    if (!validReport(r)) return res.status(400).json({ error: "That workbook couldn't be read as the report. Check that it's the 5100 Main report workbook and try again." });
    const now = new Date().toISOString();
    const report = { source: String(r.source || "workbook.xlsx").slice(0, 200), generated: now, uploadedBy: session.email, docId: body.docId ? String(body.docId).slice(0, 64) : undefined, sheets: r.sheets };
    try {
      const old = await get(REPORT_PATH, { access: "private", useCache: false }).catch(() => null);
      if (old && old.statusCode === 200) {
        const text = await new Response(old.stream).text();
        await put(`data/report-history/${now.replace(/[:.]/g, "-")}.json`, text, { access: "private", addRandomSuffix: false, contentType: "application/json" });
      }
      await put(REPORT_PATH, JSON.stringify(report), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
    } catch (err) {
      console.error("report save failed", err);
      return res.status(500).json({ error: "The workbook was read but couldn't be saved. Try again in a minute." });
    }
    return res.status(200).json({ ok: true, source: report.source, generated: now, sheets: report.sheets.map((s) => s.name) });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const blob = await get(REPORT_PATH, { access: "private", useCache: false }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return res.status(404).json({ error: "No report has been uploaded yet." });
  const text = await new Response(blob.stream).text();
  if (req.query.meta) {
    const r = JSON.parse(text);
    return res.status(200).json({ source: r.source, generated: r.generated, uploadedBy: r.uploadedBy || null, sheets: r.sheets.map((s) => s.name) });
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).send(text);
}
