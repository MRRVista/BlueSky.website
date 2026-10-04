import { getSession } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ signedIn: false });
  return res.status(200).json({ signedIn: true, email: session.email });
}
