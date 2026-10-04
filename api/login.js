import { getUserHash, verifyPassword, createSessionCookie, normalizeEmail, readJson, sameOrigin } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const { email, password } = await readJson(req);
  const e = normalizeEmail(email);
  const hash = await getUserHash(e);
  const ok = hash ? await verifyPassword(password || "", hash) : false;

  if (!ok) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: "That email and password don't match. Check both and try again." });
  }

  res.setHeader("Set-Cookie", createSessionCookie(e, hash));
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, redirect: "/home" });
}
