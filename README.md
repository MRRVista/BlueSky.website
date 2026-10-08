# bluesky.website

Blue Sky Investment Group — sign-in page and the 5100 Main Equity Strip report. Hosted on Vercel; deploys on push to `main`.

## Routes
| Path | What it is |
|---|---|
| `/` | Sign-in page |
| `/home` | Signed-in home: Overview (landing page), Performance, Income, Cash Flow, Account Split, AI Assistant, Properties, Documents, Admin, Inputs, Tax Plan, Valuation, an **Other** menu (Statement Log, Assumptions, Forecast Model, Loan & Closing, Schwab Tracker, Matt's, Real #s 8.24.2026, Discussion Topics, Watch Items), then The Report, Income & Worth It and The Honest Read |
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

## Overview and Cash Flow
`public/wealth.js` combines the Schwab positions (`/api/analytics`), both properties (`/api/properties`) and every Admin-tab loan (`/api/loans`).
- Property value = NOI ÷ the market cap rate set on the Properties tab (or the entered value). NOI is the ledger's last 12 months, or the pro forma until a year of rent is on file.
- Loans are tied to assets by their "Secured by" field; a property mortgage entered on the Properties tab is used only when no Admin loan secures that property.
- The forecaster's assumptions and custom cash flows are shared through `/api/plan` (`data/plan.json`). Tax rates come from the Income tab.

## Account Split
`lib/split.js` (served by `/api/split`, shown by `public/split.js`) divides the Schwab account into **5100 Main** (the 3/2/2026 refinance wire) and **Legacy** (the value before the wire plus every later deposit and withdrawal).
- Gains are split period by period between valuation points (month-end statements, positions exports) by each sleeve's time-weighted capital, and balances carry forward. Margin interest that accrued before the wire is Legacy's alone. The as-of date defaults to 9/30/2026 and can be changed; any date with an account value on file can be shown.
- Margin tracing rebuilds the daily cash balance from the positions exports and transactions. New borrowing takes the use of what it paid for (withdrawals: the use set on the tab, personal by default; purchases: investment); money coming in repays personal, then investment, then rental (Treas. Reg. 1.163-8T(d)). Each bill is split by average daily balance by use. Schwab interest adjustments follow the split of the bill they correct.
- The sleeve, use, note and reviewed flag for each flow are shared through `data/split.json`. The share-by-share move uses the latest positions export.

## Inputs, Tax Plan and Valuation
`public/inputs.js` (tabs) with `/api/inputs` (`lib/handlers/inputs.js`, store `data/inputs.json`), `/api/caprates` and `/api/plaid`.
- **Inputs** edits every assumption: accounts outside …965 (the IRA), each building's value, mortgage, rent roll, expenses, depreciation, cost segregation, share of mortgage interest traced to investments and sale assumptions; Admin loans and Fed Funds spreads; the tax profile; and the tax-law parameters. Building values and mortgages are written to `data/properties.json` and loans to `data/loans.json`, so every tab reads one source. The quick marginal rates are shared with the Performance, Income and Cash Flow tabs (`BSDash.setTax`). Every change is logged.
- First load seeds (10/7/2026): 5100 Main $8M value with a $5M placeholder mortgage, 333 Chestnut switched on at $18M with a $4.5M placeholder mortgage (both 6%, 30 years), and Jen's $250K Schwab IRA. Seeds never overwrite entered values.
- **Tax Plan** runs `lib/taxengine.js`: Schedule B/D (capital-loss netting, $3,000 limit, carryforwards), Schedule E with straight-line, MACRS cost segregation and bonus, Form 8582 passive limits, Form 4952 investment interest (margin plus traced mortgage interest), SALT cap, QBI (Form 8995), progressive brackets with the 0/15/20% stack, NIIT (Form 8960), Illinois with the bonus addback, and a hypothetical sale (§1245, unrecaptured §1250, §1231, 1031). Parameters in `lib/taxparams.js` (2026, with sources) and overridable on the Inputs page.
- **Valuation** is a cap-rate calculator; "Search current cap rates" asks Claude with web search for broker surveys and comparable sales (needs `ANTHROPIC_API_KEY`) and saves the result per building in `data/caprates/`.
- **Plaid** uses the Vistamark Plaid client id; set `PLAID_SECRET` (same as vistarandall), optionally `PLAID_ENV=sandbox`, and `PLAID_REDIRECT_URI=https://bluesky.website/home` (allow-listed in the Plaid dashboard) for OAuth banks such as Schwab. Access tokens are AES-GCM encrypted in `data/plaid.json`. Matt and Jen connect or remove accounts.
