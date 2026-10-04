import { get, put } from "@vercel/blob";

export async function readJson(path, fallback = null) {
  const blob = await get(path, { access: "private", useCache: false }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return fallback;
  return JSON.parse(await new Response(blob.stream).text());
}

export async function writeJson(path, value) {
  await put(path, JSON.stringify(value), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

export const PORTFOLIO_PATH = "data/portfolio.json";
