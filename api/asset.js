import { get } from "@vercel/blob";

// Brand assets (from blueskyinvestmentgroup.com) live in the private Blob store under assets/.
const ASSETS = {
  logo: "assets/logo.webp",
  favicon: "assets/favicon.png",
};

export default async function handler(req, res) {
  const path = ASSETS[req.query.f];
  if (!path) return res.status(404).end();
  const blob = await get(path, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return res.status(404).end();
  const body = Buffer.from(await new Response(blob.stream).arrayBuffer());
  res.setHeader("Content-Type", blob.blob.contentType);
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
  return res.status(200).send(body);
}
