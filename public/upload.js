(function () {
  const drop = document.getElementById("drop");
  const input = document.getElementById("file");
  const results = document.getElementById("results");
  const valsEl = document.getElementById("vals");
  const historyEl = document.getElementById("history");
  const usd = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  async function sendFiles(fileList) {
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv");
    if (!files.length) { results.replaceChildren(h("p", "msg err", "Choose CSV files exported from Schwab.")); return; }
    if (files.some((f) => f.size > 3.5e6)) { results.replaceChildren(h("p", "msg err", "One file is over 3.5 MB. Export a shorter date range and upload again.")); return; }
    results.replaceChildren(h("p", "msg", `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`));
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
    showResults(await post({ files: payload }));
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
