# bluesky.website

Blue Sky Investment Group — sign-in page and the 5100 Main Equity Strip report. Hosted on Vercel; deploys on push to `main`.

## Routes
| Path | What it is |
|---|---|
| `/` | Sign-in page |
| `/home` | Signed-in home: the 5100 Main report, one header tab per workbook tab |
| `/account` | Change password |
| `/api/login`, `/api/logout`, `/api/me`, `/api/change-password` | Auth endpoints |
| `/api/report` | Report data (signed-in only) |

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

## Report (signed-in home)
The data is **not** in this repo: `tools/extract.py` converts the workbook to JSON, which is uploaded to the private Blob store at `data/report.json` and served only to signed-in users by `/api/report`.

To refresh after a new statement: run `python3 tools/extract.py <workbook.xlsx> report.json` and upload `report.json` to `data/report.json` in the Blob store.
