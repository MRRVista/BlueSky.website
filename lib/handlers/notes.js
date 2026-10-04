import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { newId } from "../docs.js";

// Discussion Topics and Watch Items, editable by signed-in users.
const PATH = "data/notes.json";
const BOARDS = ["discussion", "watch"];
const TEXT = ["section", "title", "body", "response", "source", "owner", "status", "note"];
const clean = (o) => Object.fromEntries(TEXT.filter((k) => k in (o || {})).map((k) => [k, String(o[k] ?? "").slice(0, 20000)]));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const data = (await readJson(PATH, null)) || { discussion: [], watch: [], trash: [] };
  if (req.method === "GET") return res.status(200).json(data);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const b = await readBody(req);
  if (!BOARDS.includes(b.board) && b.op !== "restore") return res.status(400).json({ error: "Unknown list." });
  const who = session.email, at = new Date().toISOString();
  const list = data[b.board];

  if (b.op === "add") {
    const items = (Array.isArray(b.items) ? b.items : [b.item]).filter(Boolean).slice(0, 200);
    const added = items.map((it) => ({ id: newId(), ...clean(it), createdBy: who, createdAt: at, updatedBy: who, updatedAt: at })).filter((it) => (it.title || "").trim() || (it.body || "").trim());
    if (!added.length) return res.status(400).json({ error: "Nothing to add. Type or paste some text first." });
    list.push(...added);
  } else if (b.op === "update") {
    const it = list.find((x) => x.id === b.id);
    if (!it) return res.status(404).json({ error: "That item no longer exists. Refresh the page." });
    Object.assign(it, clean(b.item), { updatedBy: who, updatedAt: at });
  } else if (b.op === "delete") {
    const i = list.findIndex((x) => x.id === b.id);
    if (i < 0) return res.status(404).json({ error: "That item no longer exists." });
    const [gone] = list.splice(i, 1);
    data.trash = [{ ...gone, board: b.board, deletedBy: who, deletedAt: at }].concat(data.trash || []).slice(0, 100);
  } else if (b.op === "restore") {
    const i = (data.trash || []).findIndex((x) => x.id === b.id);
    if (i < 0) return res.status(404).json({ error: "Not in recently deleted." });
    const [it] = data.trash.splice(i, 1);
    const board = BOARDS.includes(it.board) ? it.board : "discussion";
    delete it.deletedBy; delete it.deletedAt; delete it.board;
    data[board].push({ ...it, updatedBy: who, updatedAt: at });
  } else if (b.op === "move") {
    const i = list.findIndex((x) => x.id === b.id);
    const j = i + (b.dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return res.status(200).json(data);
    [list[i], list[j]] = [list[j], list[i]];
  } else return res.status(400).json({ error: "Unknown action." });

  try { await writeJson(PATH, data); }
  catch (err) { console.error("notes save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  return res.status(200).json(data);
}
