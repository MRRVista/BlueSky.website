# bluesky.website

Blue Sky Investment Group — sign-in page and the 5100 Main Equity Strip report. Hosted on Vercel; deploys on push to `main`.

## Routes
| Path | What it is |
|---|---|
| `/` | Sign-in page |
| `/home` | Signed-in home: Performance, Income, AI Assistant, Properties, Documents, Admin, an **Other** menu (Statement Log, Assumptions, Forecast Model, Loan & Closing, Schwab Tracker, Matt's, Real #s 8.24.2026, Discussion Topics, Watch Items), then The Report, Income & Worth It and The Honest Read |
| `/upload` | Schwab exports, statement PDFs and the report workbook |
| `/account` | Change password |
| `/api/login`, `/api/logout`, `/api/me`, `/api/change-password` | Auth endpoints |
| `/api/report` | Report data (signed-in only); POST replaces it with a workbook read on the Upload page |

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
The workbook data is **not** in this repo; it lives in the private Blob store at `data/report.json` and is served only to signed-in users by `/api/report`.

To refresh after a new workbook: drop the `.xlsx` on the Upload page. `public/workbook.js` reads it in the browser (same output as `tools/extract.py`), files the original in Documents under Reports & models, and replaces the report. Each previous version is kept in `data/report-history/`.

`tools/extract.py <workbook.xlsx> report.json` still produces the same JSON for a manual upload.

Old links `#gains` and `#tax` open the merged Performance and Income tabs.
