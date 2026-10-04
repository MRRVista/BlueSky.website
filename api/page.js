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
</head>
<body>
  <div class="sky${variant ? " sky--" + variant : ""}">
    <header class="topbar">
      <a href="/home" aria-label="Blue Sky Investment Group home"><img class="logo logo--small" src="/logo.webp" alt="Blue Sky Investment Group LLC" width="479" height="340"></a>
      <nav aria-label="Account">
        <span class="who">${esc(email)}</span>
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
    script: `<script src="/report.js" defer></script>`,
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
  const page = req.query.p === "account" ? accountPage(session.email) : homePage(session.email);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page);
}
