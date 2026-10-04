# bluesky.website

Blue Sky Investment Group — sign-in page and (for now) an "Under construction" home page. Hosted on Vercel; deploys on push to `main`.

## Routes
| Path | What it is |
|---|---|
| `/` | Sign-in page |
| `/home` | Signed-in landing page (Under construction) |
| `/account` | Change password |
| `/api/login`, `/api/logout`, `/api/me`, `/api/change-password` | Auth endpoints |

## Accounts
Only the emails in `lib/auth.js` → `ALLOWED_EMAILS` can sign in.

## How auth works
- Passwords are hashed with scrypt. No plaintext passwords live in this repo.
- Starting hashes come from the `USERS_SEED` environment variable (JSON `{ "email": "scrypt$..." }`).
- When a user changes their password, the new hash is written to a **private** Vercel Blob store (`BLOB_READ_WRITE_TOKEN`) and overrides the seed.
- Sessions are HMAC-signed, HttpOnly cookies (`SESSION_SECRET`), valid 7 days. Changing a password signs out every other session.

## Environment variables (set in Vercel, never committed)
- `SESSION_SECRET` — random 64+ char string
- `USERS_SEED` — starting password hashes
- `BLOB_READ_WRITE_TOKEN` — added automatically by the connected Blob store
