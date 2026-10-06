import { getSession } from "../lib/auth.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shell({ title, email, body, script = "", variant = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <title>${esc(title)} | Blue Sky Investment Group</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/report.css">
  <link rel="stylesheet" href="/dash.css">
</head>
<body>
  <div class="sky${variant ? " sky--" + variant : ""}">
    <header class="topbar">
      <a href="/home" aria-label="Blue Sky Investment Group home"><img class="logo logo--small" src="/logo.webp" alt="Blue Sky Investment Group LLC" width="479" height="340"></a>
      <nav aria-label="Account">
        <span class="who">${esc(email)}</span>
        <a href="/upload">Upload files</a>
        <a href="/account">Change password</a>
        <form method="post" action="/api/logout" id="signout"><button class="link-button" type="submit">Sign out</button></form>
      </nav>
    </header>
    ${body}
    <footer>Blue Sky Investment Group LLC</footer>
  </div>
  <script>
    document.getElementById("signout").addEventListener("submit", async (e) => {
      e.preventDefault();
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      location.replace("/");
    });
  </script>
  ${script}
</body>
</html>`;
}

function homePage(email) {
  return shell({
    title: "5100 Main Equity Strip",
    email,
    variant: "report",
    body: `<nav class="tabs" id="tabs" aria-label="Report tabs"></nav>
    <main class="report" id="report" style="display:block;text-align:left;max-width:82rem">
      <p class="report-state">Loading the report…</p>
    </main>`,
    script: `<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" defer></script>
    <script src="/dash.js" defer></script>
    <script src="/report.js" defer></script>`,
  });
}

function uploadPage(email) {
  return shell({
    title: "Upload files",
    email,
    variant: "report",
    body: `<main class="report" style="display:block;text-align:left;max-width:82rem">
      <article class="sheet dash">
        <h2>Upload account files</h2>
        <p class="lede">Drop in Schwab exports and monthly statement PDFs. The dashboard updates as soon as they're saved. Files stay private to this site.</p>
        <div class="dropzone" id="drop" tabindex="0" role="button" aria-describedby="drop-hint">
          <p><strong>Drop files here</strong> or click to choose</p>
          <p class="note" id="drop-hint">CSV straight from Schwab (or saved as Excel), monthly statement PDFs, and the 5100 Main report workbook. Drop several at once; each is identified from its contents, not its file name.</p>
          <input type="file" id="file" accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf" multiple hidden>
        </div>
        <div id="results" class="results" role="status" aria-live="polite"></div>
        <div id="stmts"></div>

        <div class="dash-sec"><h3>The files, and where to get them in Schwab</h3>
          <p class="note">Monthly routine: after each statement posts, export Transactions, Positions and Realized Gain/Loss, drop all three here, then drop that month's statement PDF (or type its ending value below).</p></div>
        <div class="ftypes">
          <div class="ftype"><h4>1. Transactions <span class="tag req">Required</span></h4>
            <p class="where">Accounts → History → Transactions. Date range: <em>Previous 4 years</em> (or year to date) → Export.</p>
            <p>Every deposit, withdrawal, trade, distribution and margin-interest charge. Drives both return measures, income and the wash-sale dates. Overlapping exports merge without double-counting.</p>
            <p class="where">Recognized by the columns <code>Date, Action, Symbol, Description, Amount</code>.</p>
            <p class="status" id="st-transactions"></p></div>
          <div class="ftype"><h4>2. Positions <span class="tag req">Required</span></h4>
            <p class="where">Accounts → Positions → Export. Best on the last business day of the month.</p>
            <p>Holdings, cost basis, unrealized gain, yields and distribution dates. Its net value becomes a valuation point for that date.</p>
            <p class="where">Recognized by the first line <code>Positions for account … as of</code>.</p>
            <p class="status" id="st-positions"></p></div>
          <div class="ftype"><h4>3. Realized Gain/Loss, Lot Details <span class="tag req">Required</span></h4>
            <p class="where">Accounts → Realized Gain/Loss → <em>Lot Details</em> view, date range year to date → Export.</p>
            <p>Every closed lot: short- vs long-term, wash sales and deferred losses. Drives the Tax tab and realized figures. Each upload replaces that tax year.</p>
            <p class="where">Recognized by the first line <code>Realized Gain/Loss - Lot Details</code>.</p>
            <p class="status" id="st-realized"></p></div>
          <div class="ftype"><h4>4. Monthly statement (PDF) <span class="tag req">Required</span></h4>
            <p class="where">Accounts → Statements &amp; Tax Forms → download the monthly statement PDF and drop it here. Or type the ending value from page 1 in the form below.</p>
            <p>Time-weighted returns link one month-end value to the next. Without a month-end value, that month and any window starting there can't be measured. The site reads the statement period and the beginning and ending values, shows what it found, and saves only after you confirm. The PDF is filed in Documents.</p></div>
          <div class="ftype"><h4>5. Balances <span class="tag">Optional</span></h4>
            <p class="where">Accounts → Balances → Export.</p>
            <p>If the file shows a labeled <em>Account Value</em>, it's added as a valuation point for its date; otherwise it's kept for reference.</p>
            <p class="where">Recognized by the first line <code>Balances for account</code>.</p>
            <p class="status" id="st-balances"></p></div>
          <div class="ftype"><h4>6. Investment Income <span class="tag">Optional</span></h4>
            <p class="where">Accounts → History → Investment Income. Set the start date to January 1 first, or the export comes out empty.</p>
            <p>Not needed: income is already calculated from Transactions. Keep it as a cross-check against Schwab's own totals.</p>
            <p class="where">Recognized by the first line <code>Investment Income</code>.</p>
            <p class="status" id="st-income"></p></div>
          <div class="ftype"><h4>7. 5100 Main report workbook <span class="tag">When it changes</span></h4>
            <p class="where">The <em>5100 Main Equity Strip REPORT</em> Excel workbook (.xlsx).</p>
            <p>Replaces the workbook tabs on the home page (The Report, Income &amp; Worth It, and everything under Other). The previous version is kept, and the workbook is filed in Documents.</p>
            <p class="where">Recognized by its tab names (The Report, Statement Log, Assumptions…).</p>
            <p class="status" id="st-report"></p></div>
        </div>

        <div class="dash-sec"><h3>Add a statement value</h3>
          <p class="note">Enter the ending account value from page 1 of the statement, net of the margin loan. Positions uploads add a value automatically for their date.</p></div>
        <div class="tax-form" id="valform">
          <label class="tax-field"><span>Statement date</span><input id="v-date" type="date"></label>
          <label class="tax-field"><span>Ending account value (net) $</span><input id="v-value" type="number" step="0.01"></label>
          <div class="tax-field"><span>&nbsp;</span><button class="btn-small" id="v-save" type="button">Save value</button></div>
        </div>
        <div id="vals"></div>
        <div id="history"></div>
        <p style="margin-top:1.5rem"><a href="/home#performance" style="color:#183763">Go to the dashboard</a></p>
      </article>
    </main>`,
    script: `<script src="/statement.js" defer></script><script src="/workbook.js" defer></script><script src="/upload.js" defer></script>`,
  });
}

function accountPage(email) {
  return shell({
    title: "Change password",
    email,
    body: `<main>
      <form class="panel" id="change" novalidate>
        <h1>Change password</h1>
        <div class="field">
          <label for="current">Current password</label>
          <input id="current" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="next">New password</label>
          <input id="next" type="password" autocomplete="new-password" minlength="8" required aria-describedby="next-hint">
          <p class="hint" id="next-hint">At least 8 characters.</p>
        </div>
        <div class="field">
          <label for="confirm">Confirm new password</label>
          <input id="confirm" type="password" autocomplete="new-password" required>
        </div>
        <button class="btn-primary" type="submit">Save password</button>
        <p class="message" id="message" role="status" aria-live="polite"></p>
      </form>
      <p style="margin-top:1.25rem"><a href="/home">Back to home</a></p>
    </main>`,
    script: `<script>
      const form = document.getElementById("change");
      const msg = document.getElementById("message");
      const button = form.querySelector("button");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        msg.textContent = "";
        const currentPassword = form.current.value;
        const newPassword = form.next.value;
        const confirmPassword = form.confirm.value;
        if (newPassword.length < 8) { msg.dataset.kind = "error"; msg.textContent = "Choose a new password with at least 8 characters."; return; }
        if (newPassword !== confirmPassword) { msg.dataset.kind = "error"; msg.textContent = "The two new passwords don't match."; return; }
        button.disabled = true; button.textContent = "Saving…";
        try {
          const r = await fetch("/api/change-password", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
          });
          const data = await r.json().catch(() => ({}));
          if (r.ok) { form.reset(); msg.dataset.kind = "ok"; msg.textContent = "Password saved. Use it next time you sign in."; }
          else if (r.status === 401) { location.replace("/"); return; }
          else { msg.dataset.kind = "error"; msg.textContent = data.error || "Your password couldn't be saved. Try again."; }
        } catch { msg.dataset.kind = "error"; msg.textContent = "Can't reach the server. Check your connection and try again."; }
        button.disabled = false; button.textContent = "Save password";
      });
    </script>`,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  const page = req.query.p === "account" ? accountPage(session.email) : req.query.p === "upload" ? uploadPage(session.email) : homePage(session.email);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page);
}
