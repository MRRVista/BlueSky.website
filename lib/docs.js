import { randomBytes } from "node:crypto";
import { readJson, writeJson } from "./store.js";

export const DOCS_PATH = "data/docs.json";
export const newId = () => Date.now().toString(36) + randomBytes(5).toString("hex");
export const safeName = (n) => String(n || "file").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 120) || "file";

export async function readDocs() { return (await readJson(DOCS_PATH, null)) || { docs: [] }; }
export async function addDoc(entry) {
  const idx = await readDocs();
  idx.docs.push(entry);
  await writeJson(DOCS_PATH, idx);
  return entry;
}
