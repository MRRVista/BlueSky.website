import { getSession, verifyPassword, hashPassword, setUserHash, createSessionCookie, readJson, sameOrigin } from "../lib/auth.js";

const MIN_LENGTH = 8;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Your session ended. Sign in again to change your password." });

  const { currentPassword, newPassword, confirmPassword } = await readJson(req);

  if (!(await verifyPassword(currentPassword || "", session.hash))) {
    return res.status(400).json({ error: "Your current password is incorrect." });
  }
  if (typeof newPassword !== "string" || newPassword.length < MIN_LENGTH) {
    return res.status(400).json({ error: `Choose a new password with at least ${MIN_LENGTH} characters.` });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "The two new passwords don't match." });
  }
  if (await verifyPassword(newPassword, session.hash)) {
    return res.status(400).json({ error: "Choose a password that's different from your current one." });
  }

  const hash = await hashPassword(newPassword);
  try {
    await setUserHash(session.email, hash);
  } catch (err) {
    console.error("password save failed", err);
    return res.status(500).json({ error: "Your password couldn't be saved. Try again in a minute." });
  }

  // Re-issue this browser's session; other sessions are signed out by the hash change.
  res.setHeader("Set-Cookie", createSessionCookie(session.email, hash));
  return res.status(200).json({ ok: true });
}
