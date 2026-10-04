import { issueSignedToken, presignUrl, head, del } from "@vercel/blob";
import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { writeJson } from "../store.js";
import { DOCS_PATH, readDocs, newId, safeName } from "../docs.js";

// Document repository. Files go browser -> private Blob through short-lived presigned URLs,
// so size isn't limited by the function body cap; downloads redirect to a 5-minute signed link.
const MAX_BYTES = 250 * 1024 * 1024;
export const CATEGORIES = ["Loan documents", "Schwab statements", "Tax", "Property & leases", "Insurance", "Legal", "Reports & models", "Correspondence", "Schwab exports", "Other"];

async function signed(pathname, op, minutes) {
  const tok = await issueSignedToken({ pathname, operations: [op], validUntil: Date.now() + minutes * 60e3 });
  return tok;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });

  if (req.method === "GET") {
    const idx = await readDocs();
    if (req.query.dl) {
      const d = idx.docs.find((x) => x.id === req.query.dl);
      if (!d) return res.status(404).send("Document not found.");
      const tok = await signed(d.pathname, "get", 5);
      const { presignedUrl } = await presignUrl(tok, { operation: "get", pathname: d.pathname, access: "private", useCache: false });
      res.writeHead(302, { Location: presignedUrl });
      return res.end();
    }
    if (req.query.links) {
      // Short-lived links for a client-side "download all" (zip).
      const ids = String(req.query.links).split(",").slice(0, 300);
      const tok = await issueSignedToken({ pathname: "*", operations: ["get"], validUntil: Date.now() + 10 * 60e3 }).catch(() => null);
      const links = {};
      for (const d of idx.docs.filter((x) => ids.includes(x.id))) {
        const t2 = tok || (await signed(d.pathname, "get", 10));
        links[d.id] = (await presignUrl(t2, { operation: "get", pathname: d.pathname, access: "private", useCache: false })).presignedUrl;
      }
      return res.status(200).json({ links });
    }
    return res.status(200).json({ docs: idx.docs.slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), categories: CATEGORIES });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const b = await readBody(req);
  const who = session.email, at = new Date().toISOString();

  if (b.op === "sign") {
    const size = Number(b.size) || 0;
    if (size > MAX_BYTES) return res.status(400).json({ error: "Files up to 250 MB can be stored here." });
    const id = newId();
    const pathname = `docs/${id}/${safeName(b.filename)}`;
    const tok = await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.now() + 30 * 60e3, maximumSizeInBytes: MAX_BYTES });
    const { presignedUrl } = await presignUrl(tok, { operation: "put", pathname, access: "private", addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_BYTES });
    return res.status(200).json({ id, pathname, url: presignedUrl });
  }

  const idx = await readDocs();
  if (b.op === "commit") {
    const pathname = String(b.pathname || "");
    if (!pathname.startsWith(`docs/${b.id}/`)) return res.status(400).json({ error: "Upload didn't match. Try again." });
    const meta = await head(pathname).catch(() => null);
    if (!meta) return res.status(400).json({ error: "The file didn't finish uploading. Try again." });
    const doc = {
      id: b.id, pathname, filename: String(b.filename || pathname.split("/").pop()).slice(0, 200),
      label: String(b.label || b.filename || "Untitled").slice(0, 200), category: CATEGORIES.includes(b.category) ? b.category : "Other",
      docDate: /^\d{4}-\d{2}-\d{2}$/.test(b.docDate || "") ? b.docDate : null, notes: String(b.notes || "").slice(0, 4000),
      size: meta.size, contentType: meta.contentType, uploadedBy: who, uploadedAt: at,
    };
    idx.docs.push(doc);
  } else if (b.op === "update") {
    const d = idx.docs.find((x) => x.id === b.id);
    if (!d) return res.status(404).json({ error: "Document not found." });
    if (b.label != null) d.label = String(b.label).slice(0, 200);
    if (b.category != null && CATEGORIES.includes(b.category)) d.category = b.category;
    if (b.docDate !== undefined) d.docDate = /^\d{4}-\d{2}-\d{2}$/.test(b.docDate || "") ? b.docDate : null;
    if (b.notes != null) d.notes = String(b.notes).slice(0, 4000);
    d.updatedBy = who; d.updatedAt = at;
  } else if (b.op === "delete") {
    const d = idx.docs.find((x) => x.id === b.id);
    if (!d) return res.status(404).json({ error: "Document not found." });
    await del(d.pathname).catch((e) => console.error("blob delete failed", e.message));
    idx.docs = idx.docs.filter((x) => x.id !== b.id);
  } else return res.status(400).json({ error: "Unknown action." });

  try { await writeJson(DOCS_PATH, idx); }
  catch (err) { console.error("docs save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json({ ok: true, docs: idx.docs.slice().sort((a, b2) => b2.uploadedAt.localeCompare(a.uploadedAt)), categories: CATEGORIES });
}
