import { clearSessionCookie } from "../lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.setHeader("Cache-Control", "no-store");
  const isFetch = req.method === "POST" && !String(req.headers["content-type"] || "").includes("form");
  if (isFetch) return res.status(200).json({ ok: true, redirect: "/" });
  res.writeHead(303, { Location: "/" });
  return res.end();
}
