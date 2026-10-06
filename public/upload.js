(function () {
  const drop = document.getElementById("drop");
  const input = document.getElementById("file");
  const results = document.getElementById("results");
  const valsEl = document.getElementById("vals");
  const historyEl = document.getElementById("history");
  const usd = (n) => (Number(n) < 0 ? "−" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  async function post(body) {
    const r = await fetch("/api/upload", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { location.replace("/"); return null; }
    return r.json().catch(() => ({ error: "Unexpected response." }));
  }

  function showResults(res) {
    results.replaceChildren();
    if (!res) return;
    if (res.error) results.append(h("p", "msg err", res.error));
    (res.results || []).forEach((r) => {
      const p = h("p", "msg " + (r.ok ? "ok" : "err"));
      p.append(h("strong", null, r.name + ": "), document.createTextNode(r.message));
      results.append(p);
    });
    load();
  }

  // Excel files are converted to CSV in the browser (first sheet), so the server only ever sees CSV.
  let xlsxLib = null;
  function loadXlsx() {
    if (xlsxLib) return xlsxLib;
    xlsxLib = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      sc.onload = () => resolve(window.XLSX);
      sc.onerror = () => { xlsxLib = null; reject(new Error("xlsx")); };
      document.head.append(sc);
    });
    return xlsxLib;
  }
  async function toText(f) {
    if (/\.xlsx?$/i.test(f.name)) {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: false });
      return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { forceQuotes: true });
    }
    return f.text();
  }

  async function sendFiles(fileList) {
    const all = [...fileList];
    const pdfs = all.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    let files = all.filter((f) => !pdfs.includes(f) && (/\.(csv|xlsx|xls)$/i.test(f.name) || f.type === "text/csv"));
    // The 5100 Main report workbook goes to the report, not the Schwab importer.
    const books = [];
    for (const f of files.filter((x) => /\.xlsx$/i.test(x.name))) {
      const rep = await readReportBook(f).catch(() => null);
      if (rep) books.push({ f, rep });
    }
    if (books.length) { files = files.filter((f) => !books.some((b) => b.f === f)); books.forEach((b) => saveReportBook(b.f, b.rep)); }
    if (books.length && !files.length && !pdfs.length) { input.value = ""; return; }
    if (!files.length && !pdfs.length) { results.replaceChildren(h("p", "msg err", "Choose CSV or Excel exports, or statement PDFs, from Schwab.")); return; }
    if (pdfs.length) handlePdfs(pdfs);
    if (!files.length) { input.value = ""; return; }
    if (files.some((f) => f.size > 3.5e6)) { results.replaceChildren(h("p", "msg err", "One file is over 3.5 MB. Export a shorter date range and upload again.")); return; }
    results.replaceChildren(h("p", "msg", `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`));
    let payload;
    try { payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await toText(f) }))); }
    catch { results.replaceChildren(h("p", "msg err", "An Excel file couldn't be opened here. Upload the original CSV from Schwab instead.")); return; }
    showResults(await post({ files: payload }));
  }


  /* ---------- Report workbook: read in the browser, file the .xlsx in Documents, replace the report ---------- */
  const REPORT_SHEETS = ["The Report", "Statement Log", "Assumptions", "Schwab Tracker", "Forecast to 2031", "Loan & Closing"];
  const loadJsZip = () => (window.JSZip ? Promise.resolve(window.JSZip) : new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    sc.onload = () => resolve(window.JSZip); sc.onerror = () => reject(new Error("zip"));
    document.head.append(sc);
  }));
  async function readReportBook(f) {
    if (f.size > 25e6) return null;
    await loadJsZip();
    const rep = await window.BSWorkbook.extract(await f.arrayBuffer(), f.name);
    const names = rep.sheets.map((s) => s.name);
    return REPORT_SHEETS.filter((n) => names.includes(n)).length >= 2 ? rep : null;
  }
  async function saveReportBook(f, rep) {
    const card = el("div", "stmt-card", el("h4", null, f.name), el("p", "note", `Report workbook: ${rep.sheets.length} sheets read. Saving…`));
    stmts.prepend(card);
    let docId = null, filed = "";
    try {
      const call = async (body) => {
        const r = await fetch("/api/docs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Couldn't file the workbook.");
        return d;
      };
      const sig = await call({ op: "sign", filename: f.name, size: f.size });
      const put = await fetch(sig.url, { method: "PUT", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: f });
      if (!put.ok) throw new Error("The workbook didn't upload to Documents.");
      await call({ op: "commit", id: sig.id, pathname: sig.pathname, filename: f.name, label: `5100 Main report workbook (${f.name})`, category: "Reports & models", docDate: new Date().toISOString().slice(0, 10), notes: "Uploaded on the Upload page; replaced the report tabs." });
      docId = sig.id; filed = " The workbook is filed in Documents under Reports & models.";
    } catch (e) { filed = ` (${e.message} The report itself still updates.)`; }
    const r = await fetch("/api/report", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report: rep, docId }) });
    if (r.status === 401) { location.replace("/"); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { card.replaceChildren(el("h4", null, f.name), el("p", "msg err", d.error || "The report couldn't be saved. Try again.")); return; }
    card.replaceChildren(el("h4", null, f.name), el("p", "msg ok", `Report updated: ${d.sheets.length} tabs (${d.sheets.join(", ")}). The previous version is kept.${filed}`));
    loadReportMeta();
  }
  async function loadReportMeta() {
    const st = document.getElementById("st-report");
    if (!st) return;
    const r = await fetch("/api/report?meta=1", { credentials: "same-origin" }).catch(() => null);
    const d = r && r.ok ? await r.json() : null;
    st.className = "status" + (d ? "" : " none");
    st.textContent = d ? `On file: ${d.source}, loaded ${fmt(d.generated)}${d.uploadedBy ? ` by ${d.uploadedBy}` : ""}` : "Not uploaded yet";
  }
  loadReportMeta();

  /* ---------- Statement PDFs: read in the browser, confirm, then save ---------- */
  const stmts = document.getElementById("stmts");
  let currentVals = [];
  const ACCOUNT_TAIL = "965";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const el = (tag, cls, ...kids) => { const n = h(tag, cls); kids.flat().forEach((k) => k != null && n.append(k.nodeType ? k : document.createTextNode(String(k)))); return n; };

  let pdfLib = null;
  function loadPdf() {
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; resolve(window.pdfjsLib); };
      sc.onerror = () => { pdfLib = null; reject(new Error("pdf")); };
      document.head.append(sc);
    });
    return pdfLib;
  }
  async function readPdf(f) {
    const lib = await loadPdf();
    const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      lines.push(...window.BSStatement.linesFromItems(tc.items));
    }
    return { lines, pages: doc.numPages };
  }
  async function fileToDocuments(f, label, docDate) {
    const call = async (body) => {
      const r = await fetch("/api/docs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't file the PDF.");
      return d;
    };
    const sig = await call({ op: "sign", filename: f.name, size: f.size });
    const put = await fetch(sig.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: f });
    if (!put.ok) throw new Error("The PDF didn't upload to Documents.");
    await call({ op: "commit", id: sig.id, pathname: sig.pathname, filename: f.name, label, category: "Schwab statements", docDate, notes: "Uploaded on the Upload page; values read from the PDF and confirmed." });
  }

  async function handlePdfs(pdfs) {
    input.value = "";
    for (const f of pdfs) {
      const card = el("div", "stmt-card", el("h4", null, f.name), el("p", "note", "Reading the statement…"));
      stmts.prepend(card);
      if (f.size > 25e6) { card.replaceChildren(el("h4", null, f.name), el("p", "msg err", "This PDF is over 25 MB. Statements are usually under 1 MB; check it's the right file.")); continue; }
      let read, r;
      try { read = await readPdf(f); r = window.BSStatement.parseStatement(read.lines); }
      catch (e) { card.replaceChildren(el("h4", null, f.name), el("p", "msg err", e.message === "pdf" ? "The PDF reader didn't load. Check the connection and try again." : "This PDF couldn't be opened. Download the statement from Schwab again and retry.")); continue; }
      if (read.lines.length < 5) { card.replaceChildren(el("h4", null, f.name), el("p", "msg err", "This PDF has no readable text (it may be a scan or a photo). Download the statement from Schwab as a PDF, or type the ending value in the form below.")); continue; }
      renderCard(card, f, r);
    }
  }

  function renderCard(card, f, r) {
    const end = r.period && r.period.end;
    const title = end ? `Schwab statement, ${MONTHS[+end.slice(5, 7) - 1]} ${end.slice(0, 4)}` : f.name;
    const dateIn = Object.assign(h("input"), { type: "date", value: end || "" });
    const valIn = Object.assign(h("input"), { type: "number", step: "0.01", value: r.ending ? r.ending.value.toFixed(2) : "" });
    const found = el("dl", "stmt-found");
    const row = (label, item, fmtFn) => found.append(el("dt", null, label), el("dd", null, item ? fmtFn(item) : el("span", "muted", "not found"), item ? el("small", "muted", ` from “${item.line}”`) : null));
    row("Statement period", r.period, (x) => (x.start ? `${fmt(x.start)} – ${fmt(x.end)}` : `as of ${fmt(x.end)}`));
    row("Beginning value", r.beginning, (x) => usd(x.value));
    row("Ending value", r.ending, (x) => usd(x.value));
    row("Deposits", r.deposits, (x) => usd(x.value));
    row("Withdrawals", r.withdrawals, (x) => usd(x.value));
    row("Dividends and interest", r.income, (x) => usd(x.value));

    // Checks against what's already on file
    const checks = el("ul", "stmt-checks");
    const add = (ok, text) => checks.append(el("li", ok === true ? "ok" : ok === false ? "warn" : "info", (ok === true ? "✓ " : ok === false ? "! " : "· ") + text));
    if (!r.schwab) add(false, "The word “Schwab” doesn't appear on the first pages. Check this is a Schwab statement.");
    if (r.account) add(r.account.endsWith(ACCOUNT_TAIL), r.account.endsWith(ACCOUNT_TAIL) ? `Account …${ACCOUNT_TAIL}.` : `This statement is for account …${r.account}, not …${ACCOUNT_TAIL}.`);
    if (!r.ending) add(false, "The ending value wasn't found. Type it in from page 1 before saving.");
    if (!end) add(false, "The statement period wasn't found. Enter the statement's end date before saving.");
    let saveBegin = null;
    if (r.period && r.period.start && r.beginning) {
      const prior = addDays(r.period.start, -1);
      const onFile = currentVals.find((v) => v.date === prior);
      if (onFile) {
        const diff = Math.abs(onFile.value - r.beginning.value);
        add(diff < 1, diff < 1 ? `Beginning value matches the ${fmt(prior)} value on file.` : `Beginning value ${usd(r.beginning.value)} differs from the ${usd(onFile.value)} on file for ${fmt(prior)} (${onFile.source}).`);
      } else {
        saveBegin = Object.assign(h("input"), { type: "checkbox", checked: true });
        checks.append(el("li", "info", el("label", "stmt-opt", saveBegin, ` Also save the beginning value, ${usd(r.beginning.value)}, as the ${fmt(prior)} account value (none is on file).`)));
      }
    }
    if (end && r.ending) {
      const same = currentVals.find((v) => v.date === end);
      if (same) { const diff = Math.abs(same.value - r.ending.value); add(diff < 1 ? true : null, diff < 1 ? `Matches the ${fmt(end)} value already on file.` : `Replaces the ${usd(same.value)} on file for ${fmt(end)} (${same.source}).`); }
    }

    const msg = el("p", "msg");
    const save = Object.assign(h("button", "btn-small", "Confirm and save"), { type: "button" });
    const discard = Object.assign(h("button", "link-button dark", "Discard"), { type: "button" });
    discard.addEventListener("click", () => card.remove());
    save.addEventListener("click", async () => {
      const date = dateIn.value, value = Number(valIn.value);
      if (!date || !valIn.value || !(value > 0)) { msg.className = "msg err"; msg.textContent = "Enter the statement end date and the ending value first."; return; }
      save.disabled = true; msg.className = "msg"; msg.textContent = "Saving…";
      const res = await post({ valuation: { date, value, from: "pdf", file: f.name } });
      if (!res || res.error) { msg.className = "msg err"; msg.textContent = (res && res.error) || "Couldn't save. Try again."; save.disabled = false; return; }
      const done = [`${fmt(date)} account value ${usd(value)} saved.`];
      if (saveBegin && saveBegin.checked) {
        const prior = addDays(r.period.start, -1);
        const res2 = await post({ valuation: { date: prior, value: r.beginning.value, from: "pdf-begin", file: f.name } });
        done.push(res2 && !res2.error ? `${fmt(prior)} value ${usd(r.beginning.value)} saved.` : `The ${fmt(prior)} value couldn't be saved.`);
      }
      try { await fileToDocuments(f, title, date); done.push("PDF filed in Documents under Schwab statements."); }
      catch (e) { done.push(`The values are saved, but ${e.message.toLowerCase()} Add it on the Documents tab.`); }
      card.replaceChildren(el("h4", null, title), el("p", "msg ok", done.join(" ")));
      load();
    });

    card.replaceChildren(
      el("h4", null, title, el("small", "muted", `  ${f.name}`)),
      found, checks,
      el("div", "tax-form",
        el("label", "tax-field", el("span", null, "Statement end date"), dateIn),
        el("label", "tax-field", el("span", null, "Ending account value (net) $"), valIn),
        el("div", "tax-field", el("span", null, " "), el("div", "stmt-btns", save, discard))),
      msg);
  }

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => sendFiles(input.files));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => sendFiles(e.dataTransfer.files));

  document.getElementById("v-save").addEventListener("click", async () => {
    const date = document.getElementById("v-date").value;
    const value = document.getElementById("v-value").value;
    if (!date || value === "") { results.replaceChildren(h("p", "msg err", "Enter both the statement date and the ending account value.")); return; }
    showResults(await post({ valuation: { date, value: Number(value) } }));
  });

  async function load() {
    const r = await fetch("/api/upload", { credentials: "same-origin" });
    if (!r.ok) return;
    const d = await r.json();
    currentVals = d.valuations || [];
    const labels = { transactions: "Transactions", positions: "Positions", realized: "Realized Gain/Loss", income: "Investment Income", balances: "Balances" };
    Object.keys(labels).forEach((k) => {
      const el = document.getElementById("st-" + k);
      if (!el) return;
      const f = d.onFile && d.onFile[k];
      el.className = "status" + (f ? "" : " none");
      el.textContent = f ? `On file: ${f.name}, uploaded ${fmt(f.uploadedAt)}` : "Not uploaded yet";
    });
    const t = h("table", "grid dgrid");
    t.innerHTML = "<thead><tr><th>Date</th><th class='num'>Account value</th><th>Source</th><th></th></tr></thead>";
    const tb = h("tbody");
    d.valuations.slice().reverse().forEach((v) => {
      const tr = h("tr");
      tr.append(h("td", null, fmt(v.date)), h("td", "num", usd(v.value)), h("td", "muted", v.source));
      const td = h("td");
      const b = h("button", "link-button dark", "Remove");
      b.type = "button";
      b.addEventListener("click", async () => { if (confirm(`Remove the ${fmt(v.date)} value?`)) showResults(await post({ removeValuation: v.date })); });
      td.append(b); tr.append(td); tb.append(tr);
    });
    t.append(tb);
    valsEl.replaceChildren(h("p", "note", `${d.valuations.length} valuation points. ${d.transactions} transactions on file; latest positions ${d.positionsAsOf ? fmt(d.positionsAsOf) : "none"}; realized years ${d.realizedYears.join(", ") || "none"}.`), t);
    const hist = h("div");
    hist.append(h("h3", null, "Recent uploads"));
    const ul = h("ul", "jason");
    d.files.slice(0, 12).forEach((f) => ul.append(h("li", null, `${fmt(f.uploadedAt)}: ${f.name} (${f.type}) by ${f.by}`)));
    hist.append(ul);
    historyEl.replaceChildren(hist);
  }
  load();
})();
