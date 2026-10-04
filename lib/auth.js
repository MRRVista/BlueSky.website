import crypto from "node:crypto";
import { promisify } from "node:util";
import { get, put } from "@vercel/blob";

const scrypt = promisify(crypto.scrypt);

export const COOKIE = "bs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// The only accounts allowed to sign in.
export const ALLOWED_EMAILS = [
  "mrice@vistamarkllc.com",
  "jen@blueskyinvestmentgroup.com",
];

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/* ---------- password hashing (scrypt) ---------- */

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltB64, keyB64] = stored.split("$");
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/* ---------- user store ----------
   Initial hashes come from the USERS_SEED env var (JSON: { email: hash }).
   Changed passwords are written to a private Vercel Blob store and take precedence. */

function userPath(email) {
  const id = crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
  return `users/${id}.json`;
}

function seedHash(email) {
  try {
    const seed = JSON.parse(process.env.USERS_SEED || "{}");
    return seed[normalizeEmail(email)] || null;
  } catch {
    return null;
  }
}

export async function getUserHash(email) {
  const e = normalizeEmail(email);
  if (!ALLOWED_EMAILS.includes(e)) return null;
  try {
    const res = await get(userPath(e), { access: "private", useCache: false });
    if (res && res.statusCode === 200 && res.stream) {
      const text = await new Response(res.stream).text();
      const record = JSON.parse(text);
      if (record && record.hash) return record.hash;
    }
  } catch (err) {
    // Not found or store unavailable: fall back to the seed hash.
    if (err && err.name !== "BlobNotFoundError") console.error("blob read failed", err.message);
  }
  return seedHash(e);
}

export async function setUserHash(email, hash) {
  const e = normalizeEmail(email);
  await put(userPath(e), JSON.stringify({ email: e, hash, updatedAt: new Date().toISOString() }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

/* ---------- sessions (HMAC-signed cookie) ----------
   The token carries a fingerprint of the current password hash,
   so changing a password signs out every other session. */

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not configured");
  return s;
}

function fingerprint(hash) {
  return crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 16);
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionCookie(email, hash) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ e: normalizeEmail(email), x: exp, f: fingerprint(hash) })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Returns { email, hash } for a valid session, otherwise null.
export async function getSession(req) {
  const token = readCookie(req, COOKIE);
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || data.x < Math.floor(Date.now() / 1000)) return null;
  const hash = await getUserHash(data.e);
  if (!hash || fingerprint(hash) !== data.f) return null;
  return { email: data.e, hash };
}

/* ---------- request helpers ---------- */

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser or same-origin navigation
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
