// Blue Sky workspace: editable Discussion Topics and Watch Items, Documents repository, Admin (loans & rates).
(function () {
  const usd = (n, d = 0) => n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 2) => n == null || !isFinite(n) ? "—" : Number(n).toFixed(d) + "%";
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${+m}/${+d}/${y}`; };
  const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const who = (e) => String(e || "").replace(/@.*/, "").replace(/^mrice$/, "Matt").replace(/^jen$/, "Jen");
  const fileSize = (b) => b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
  const today = () => new Date().toLocaleDateString("en-CA");

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sheet = (title, lede) => h("article", { class: "sheet dash ws" }, h("h2", {}, title), lede ? h("p", { class: "lede" }, lede) : null);
  const section = (title, note) => h("div", { class: "dash-sec" }, h("h3", {}, title), note ? h("p", { class: "note" }, note) : null);
  const field = (label, input, hint) => h("label", { class: "tax-field" }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
  const select = (options, value) => h("select", { class: "ws-select" }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; const opt = h("option", { value: v }, l); if (String(v) === String(value ?? "")) opt.selected = true; return opt; }));
  const toast = (root, msg, kind = "ok") => {
    const t = h("div", { class: `ws-toast ${kind}`, role: "status" }, msg);
    root.prepend(t);
    setTimeout(() => t.remove(), kind === "err" ? 6000 : 2500);
  };

  async function api(url, body) {
    const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }
  async function copyText(text, root) {
    try { await navigator.clipboard.writeText(text); toast(root, "Copied to the clipboard."); }
    catch { const ta = h("textarea", {}, text); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast(root, "Copied to the clipboard."); }
  }
  function loading(root, title) { root.replaceChildren(sheet(title, "Loading…")); }

  /* ======================= NOTE BOARDS ======================= */
  const BOARDS = {
    discussion: {
      title: "Discussion topics", lede: "Questions, answers and follow-ups between Jen and Matt. Edits save immediately for both of you; deleted items can be restored at the bottom.",
      sections: ["Open topics", "Follow-ups", "For Jason (CPA)", "Next deliverables", "Reference"],
      statuses: ["Open", "In progress", "Assigned", "Resolved"],
      fields: [["title", "Topic or question", "textarea"], ["response", "Response", "textarea"], ["source", "Source / data", "input"]],
    },
    watch: {
      title: "Watch items", lede: "Risks to keep an eye on, with who to raise them with. Edits save immediately for both of you.",
      sections: ["Watch items"],
      statuses: ["Open", "Monitoring", "Resolved"],
      fields: [["title", "Risk", "input"], ["body", "Why it matters", "textarea"], ["owner", "Raise with", "input"], ["note", "Latest status", "textarea"]],
    },
  };
  const itemText = (it, cfg) => [it.title, ...cfg.fields.slice(1).map(([k, label]) => (it[k] ? `${label}: ${it[k]}` : null)), it.status ? `Status: ${it.status}` : null].filter(Boolean).join("\n");

  async function renderBoard(root, key) {
    const cfg = BOARDS[key];
    loading(root, cfg.title);
    let data;
    try { data = await api("/api/notes"); } catch (e) { root.replaceChildren(sheet(cfg.title, e.message)); return; }
    let query = "", statusFilter = "";

    const s = sheet(cfg.title, cfg.lede);
    const listEl = h("div");
    const draw = () => {
      const items = data[key].filter((it) => (!statusFilter || it.status === statusFilter) && (!query || JSON.stringify(it).toLowerCase().includes(query)));
      const groups = cfg.sections.concat([...new Set(items.map((i) => i.section).filter((x) => x && !cfg.sections.includes(x)))]);
      listEl.replaceChildren(...groups.map((sec) => {
        const its = items.filter((i) => (i.section || cfg.sections[0]) === sec);
        if (!its.length) return null;
        return h("div", { class: "ws-group" }, h("h3", { class: "ws-group-title" }, `${sec} `, h("span", { class: "muted" }, `(${its.length})`)), its.map((it, i) => card(it, i + 1)));
      }).filter(Boolean));
      if (!items.length) listEl.append(h("p", { class: "note" }, query || statusFilter ? "Nothing matches the filter." : "No items yet. Add one above."));
      trashEl.replaceChildren(...trash());
    };
    const save = async (body, msg) => {
      try { data = await api("/api/notes", { board: key, ...body }); draw(); if (msg) toast(s, msg); }
      catch (e) { toast(s, e.message, "err"); }
    };

    function card(it, n) {
      const c = h("div", { class: "ws-card" + (it.status === "Resolved" ? " done" : "") });
      const view = () => {
        const long = (t) => {
          if (!t) return null;
          const p = h("p", { class: "ws-text" }, t);
          if (t.length < 700) return p;
          p.classList.add("clamp");
          const more = h("button", { class: "link-button dark", type: "button" }, "Show more");
          more.addEventListener("click", () => { p.classList.toggle("clamp"); more.textContent = p.classList.contains("clamp") ? "Show more" : "Show less"; });
          return h("div", {}, p, more);
        };
        c.replaceChildren(
          h("div", { class: "ws-card-head" }, h("span", { class: "ws-num" }, `${n}.`), h("div", { class: "ws-title" }, it.title || "(untitled)"),
            it.status ? h("span", { class: "ws-pill s-" + it.status.toLowerCase().replace(/\s+/g, "-") }, it.status) : null),
          ...cfg.fields.slice(1).map(([k, label]) => it[k] ? h("div", { class: "ws-field" }, h("div", { class: "ws-label" }, label), long(it[k])) : null),
          h("div", { class: "ws-foot" },
            h("span", { class: "muted" }, it.updatedBy && it.updatedBy !== it.createdBy ? `Edited by ${who(it.updatedBy)}, ${fmtWhen(it.updatedAt)}` : `Added by ${who(it.createdBy)}, ${fmtWhen(it.createdAt)}`),
            h("span", { class: "ws-actions" },
              h("button", { class: "link-button dark", type: "button", onclick: edit }, "Edit"),
              h("button", { class: "link-button dark", type: "button", onclick: () => copyText(itemText(it, cfg), s) }, "Copy"),
              h("button", { class: "link-button dark", type: "button", title: "Move up", "aria-label": "Move up", onclick: () => save({ op: "move", id: it.id, dir: "up" }) }, "↑"),
              h("button", { class: "link-button dark", type: "button", title: "Move down", "aria-label": "Move down", onclick: () => save({ op: "move", id: it.id, dir: "down" }) }, "↓"),
              h("button", { class: "link-button dark danger", type: "button", onclick: () => { if (confirm("Delete this item? You can restore it from Recently deleted.")) save({ op: "delete", id: it.id }, "Deleted. Restore it from Recently deleted below."); } }, "Delete"))));
      };
      const edit = () => {
        const inputs = {};
        const form = h("div", { class: "ws-edit" },
          cfg.fields.map(([k, label, type]) => { inputs[k] = h(type === "textarea" ? "textarea" : "input", { rows: k === "title" ? 2 : 5, value: it[k] || "" }); if (type === "textarea") inputs[k].value = it[k] || ""; return field(label, inputs[k]); }),
          h("div", { class: "ws-row" },
            field("Section", (inputs.section = select(cfg.sections, it.section || cfg.sections[0]))),
            field("Status", (inputs.status = select([""].concat(cfg.statuses), it.status)))),
          h("div", { class: "ws-row-btns" },
            h("button", { class: "btn-small", type: "button", onclick: () => save({ op: "update", id: it.id, item: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) }, "Saved.") }, "Save"),
            h("button", { class: "link-button dark", type: "button", onclick: view }, "Cancel")));
        c.replaceChildren(form);
        inputs.title.focus();
      };
      view();
      return c;
    }

    function trash() {
      const t = (data.trash || []).filter((x) => x.board === key);
      if (!t.length) return [];
      const d = h("details", { class: "lots" }, h("summary", {}, `Recently deleted (${t.length})`));
      d.append(h("ul", { class: "jason" }, t.map((x) => h("li", {}, `${x.title || "(untitled)"} `, h("span", { class: "muted" }, `deleted by ${who(x.deletedBy)}, ${fmtWhen(x.deletedAt)} `),
        h("button", { class: "link-button dark", type: "button", onclick: () => save({ op: "restore", id: x.id, board: key }, "Restored.") }, "Restore")))));
      return [d];
    }

    // Add / paste
    const addInputs = {};
    const listMode = h("input", { type: "checkbox", id: `lm-${key}` });
    const addBox = h("div", { class: "ws-add" },
      h("h3", {}, "Add items"),
      h("p", { class: "note" }, "Type, or paste straight from an email or memo. Tick the box to turn a pasted list into one item per line."),
      h("label", { class: "tax-check ws-check", for: `lm-${key}` }, listMode, h("span", {}, "Paste a list: each line becomes its own item")),
      cfg.fields.map(([k, label, type], i) => { addInputs[k] = h(type === "textarea" || i === 0 ? "textarea" : "input", { rows: i === 0 ? 3 : 4, placeholder: i === 0 ? "Paste or type here" : "" }); return h("div", { class: i === 0 ? "" : "ws-extra" }, field(i === 0 ? label : `${label} (optional)`, addInputs[k])); }),
      h("div", { class: "ws-row" }, field("Section", (addInputs.section = select(cfg.sections, cfg.sections[0]))), field("Status", (addInputs.status = select(cfg.statuses, cfg.statuses[0])))),
      h("div", { class: "ws-row-btns" }, h("button", { class: "btn-small", type: "button", onclick: add }, "Add")));
    listMode.addEventListener("change", () => addBox.querySelectorAll(".ws-extra").forEach((e) => (e.hidden = listMode.checked)));
    async function add() {
      const base = { section: addInputs.section.value, status: addInputs.status.value };
      const text = addInputs.title.value.trim();
      let items;
      if (listMode.checked) {
        items = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim()).filter(Boolean).map((title) => ({ ...base, title }));
      } else {
        items = [{ ...base, ...Object.fromEntries(cfg.fields.map(([k]) => [k, addInputs[k].value.trim()])) }];
      }
      if (!items.length || !items.some((i) => i.title)) { toast(s, "Type or paste something first.", "err"); return; }
      await save({ op: "add", items }, `${items.length} item${items.length > 1 ? "s" : ""} added.`);
      cfg.fields.forEach(([k]) => (addInputs[k].value = ""));
    }

    const search = h("input", { type: "search", class: "ws-search", placeholder: "Search", "aria-label": "Search items" });
    search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
    const sf = select([["", "All statuses"]].concat(cfg.statuses), "");
    sf.addEventListener("change", () => { statusFilter = sf.value; draw(); });
    const copyAll = h("button", { class: "link-button dark", type: "button" }, "Copy all shown");
    copyAll.addEventListener("click", () => {
      const items = data[key].filter((it) => (!statusFilter || it.status === statusFilter) && (!query || JSON.stringify(it).toLowerCase().includes(query)));
      copyText(items.map((it, i) => `${i + 1}. ${itemText(it, cfg)}`).join("\n\n"), s);
    });
    const trashEl = h("div");
    s.append(addBox, h("div", { class: "ws-toolbar" }, search, sf, copyAll), listEl, trashEl);
    draw();
    root.replaceChildren(s);
  }

  /* ======================= DOCUMENTS ======================= */
  async function renderDocs(root) {
    loading(root, "Documents");
    let data;
    try { data = await api("/api/docs"); } catch (e) { root.replaceChildren(sheet("Documents", e.message)); return; }
    let cat = "", query = "";
    const s = sheet("Documents", "Key documents in one private place: loan papers, statements, tax files, leases, models. Files are stored permanently until deleted, and every Schwab export uploaded on the Upload page is filed here automatically.");

    // Upload
    const fileInput = h("input", { type: "file", multiple: true, hidden: true });
    const label = h("input", { placeholder: "Defaults to the file name" });
    const category = select(data.categories.filter((c) => c !== "Schwab exports"), "Loan documents");
    const docDate = h("input", { type: "date" });
    const notes = h("textarea", { rows: 2, placeholder: "Optional" });
    const status = h("div", { class: "results", role: "status", "aria-live": "polite" });
    const drop = h("div", { class: "dropzone", tabindex: "0", role: "button" }, h("p", {}, h("strong", {}, "Drop files here"), " or click to choose"), h("p", { class: "note" }, "PDFs, spreadsheets, Word files, images. Up to 250 MB each."));
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
    fileInput.addEventListener("change", () => upload([...fileInput.files]));

    const putFile = (url, file, onProgress) => new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status})`)));
      x.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
      x.send(file);
    });
    async function upload(files) {
      if (!files.length) return;
      status.replaceChildren();
      for (const f of files) {
        const line = h("p", { class: "msg" }, `${f.name}: starting…`);
        status.append(line);
        try {
          const sig = await api("/api/docs", { op: "sign", filename: f.name, size: f.size });
          await putFile(sig.url, f, (p) => (line.textContent = `${f.name}: ${Math.round(p * 100)}%`));
          data = await api("/api/docs", { op: "commit", id: sig.id, pathname: sig.pathname, filename: f.name,
            label: files.length === 1 && label.value.trim() ? label.value.trim() : f.name.replace(/\.[^.]+$/, ""), category: category.value, docDate: docDate.value, notes: notes.value });
          line.className = "msg ok"; line.textContent = `${f.name}: saved.`;
        } catch (e) { line.className = "msg err"; line.textContent = `${f.name}: ${e.message}`; }
      }
      label.value = ""; notes.value = ""; fileInput.value = "";
      draw();
    }

    s.append(h("div", { class: "ws-add" }, h("h3", {}, "Add documents"),
      h("div", { class: "tax-form" }, field("Label", label, "Used when uploading one file"), field("Category", category), field("Document date", docDate), field("Notes", notes)),
      drop, fileInput, status));

    // Library
    const chips = h("div", { class: "periodbar" });
    const search = h("input", { type: "search", class: "ws-search", placeholder: "Search documents", "aria-label": "Search documents" });
    search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); draw(); });
    const exportCsv = h("button", { class: "link-button dark", type: "button" }, "Export list (CSV)");
    const zipBtn = h("button", { class: "btn-small", type: "button" }, "Download shown as .zip");
    const libEl = h("div");
    s.append(section("Library"), h("div", { class: "ws-toolbar" }, search, exportCsv, zipBtn), chips, libEl);

    const shown = () => data.docs.filter((d) => (!cat || d.category === cat) && (!query || `${d.label} ${d.filename} ${d.notes} ${d.category}`.toLowerCase().includes(query)));
    function draw() {
      const counts = {};
      data.docs.forEach((d) => (counts[d.category] = (counts[d.category] || 0) + 1));
      chips.replaceChildren(...[["", `All (${data.docs.length})`]].concat(data.categories.filter((c) => counts[c]).map((c) => [c, `${c} (${counts[c]})`])).map(([v, l]) =>
        h("button", { type: "button", class: "pb" + (cat === v ? " on" : ""), "aria-pressed": cat === v ? "true" : "false", onclick: () => { cat = v; draw(); } }, l)));
      const rows = shown();
      if (!rows.length) { libEl.replaceChildren(h("p", { class: "note" }, data.docs.length ? "Nothing matches." : "No documents yet.")); return; }
      const t = h("table", { class: "grid dgrid" });
      t.append(h("thead", {}, h("tr", {}, ["Document", "Category", "Date", "File", "Size", "Added", ""].map((x, i) => h("th", { class: i === 4 ? "num" : null }, x)))));
      const tb = h("tbody");
      rows.forEach((d) => tb.append(row(d)));
      t.append(tb);
      libEl.replaceChildren(h("div", { class: "sheet-scroll" }, t));
    }
    function row(d) {
      const tr = h("tr");
      const view = () => tr.replaceChildren(
        h("td", {}, h("a", { href: `/api/docs?dl=${encodeURIComponent(d.id)}`, class: "ws-doclink" }, d.label), d.notes ? h("div", { class: "muted small" }, d.notes) : null),
        h("td", {}, d.category), h("td", {}, fmtDate(d.docDate)), h("td", { class: "muted small" }, d.filename), h("td", { class: "num" }, fileSize(d.size)),
        h("td", { class: "small" }, `${who(d.uploadedBy)}, ${fmtDate(d.uploadedAt)}`),
        h("td", { class: "ws-actions" },
          h("a", { href: `/api/docs?dl=${encodeURIComponent(d.id)}`, class: "link-button dark" }, "Download"),
          h("button", { class: "link-button dark", type: "button", onclick: edit }, "Edit"),
          h("button", { class: "link-button dark danger", type: "button", onclick: del }, "Delete")));
      const edit = () => {
        const l = h("input", { value: d.label }), c = select(data.categories, d.category), dt = h("input", { type: "date", value: d.docDate || "" }), n = h("textarea", { rows: 2 }); n.value = d.notes || "";
        tr.replaceChildren(h("td", { colspan: "7" }, h("div", { class: "tax-form" }, field("Label", l), field("Category", c), field("Document date", dt), field("Notes", n)),
          h("div", { class: "ws-row-btns" },
            h("button", { class: "btn-small", type: "button", onclick: async () => { try { data = await api("/api/docs", { op: "update", id: d.id, label: l.value, category: c.value, docDate: dt.value, notes: n.value }); draw(); toast(s, "Saved."); } catch (e) { toast(s, e.message, "err"); } } }, "Save"),
            h("button", { class: "link-button dark", type: "button", onclick: view }, "Cancel"))));
      };
      const del = async () => {
        if (!confirm(`Permanently delete "${d.label}"? This removes the file from storage and can't be undone.`)) return;
        try { data = await api("/api/docs", { op: "delete", id: d.id }); draw(); toast(s, "Deleted."); } catch (e) { toast(s, e.message, "err"); }
      };
      view();
      return tr;
    }
    exportCsv.addEventListener("click", () => {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Label", "Category", "Document date", "File name", "Size (bytes)", "Uploaded by", "Uploaded at", "Notes"].map(q).join(",")]
        .concat(shown().map((d) => [d.label, d.category, d.docDate, d.filename, d.size, d.uploadedBy, d.uploadedAt, d.notes].map(q).join(",")));
      const a = h("a", { href: URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" })), download: `blue-sky-documents-${today()}.csv` });
      document.body.append(a); a.click(); a.remove();
    });
    zipBtn.addEventListener("click", async () => {
      const rows = shown();
      if (!rows.length) return;
      const total = rows.reduce((a, d) => a + (d.size || 0), 0);
      if (total > 500 * 1048576 && !confirm(`That's ${fileSize(total)}. Continue?`)) return;
      zipBtn.disabled = true; zipBtn.textContent = "Preparing…";
      try {
        if (!window.JSZip) await new Promise((res, rej) => { const sc = h("script", { src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" }); sc.onload = res; sc.onerror = rej; document.head.append(sc); });
        const { links } = await api("/api/docs?links=" + rows.map((d) => d.id).join(","));
        const zip = new window.JSZip();
        let i = 0;
        for (const d of rows) {
          zipBtn.textContent = `Adding ${++i} of ${rows.length}…`;
          const r = await fetch(links[d.id]);
          if (!r.ok) continue;
          zip.folder(d.category).file(`${d.docDate ? d.docDate + " " : ""}${d.filename}`.replace(/[\\/:*?"<>|]/g, "_"), await r.blob());
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `blue-sky-documents-${today()}.zip` });
        document.body.append(a); a.click(); a.remove();
      } catch { toast(s, "The zip couldn't be built. Download files one at a time instead.", "err"); }
      zipBtn.disabled = false; zipBtn.textContent = "Download shown as .zip";
    });
    draw();
    root.replaceChildren(s);
  }

  /* ======================= ADMIN: LOANS & RATES ======================= */
  const KINDS = [["amortizing", "Amortizing loan (mortgage)"], ["margin", "Margin loan"], ["interest-only", "Interest-only loan"], ["line", "Line of credit"]];
  const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || [k, k])[1];
  const securesOptions = () => {
    const D = window.BSProps && window.BSProps.data;
    const props = D ? (D.order || Object.keys(D.properties)).map((id) => [id, D.properties[id].name]) : [["5100-main", "5100 Main"], ["333-chestnut", "333 Chestnut"]];
    return [["", "Not set"], ["portfolio", "Schwab portfolio (margin)"], ...props, ["other", "Other / unsecured"]];
  };
  const securesLabel = (v) => (securesOptions().find((x) => x[0] === v) || [v, ""])[1];

  async function renderAdmin(root) {
    loading(root, "Admin");
    let st;
    try { st = await api("/api/loans"); } catch (e) { root.replaceChildren(sheet("Admin", e.message)); return; }
    const s = sheet("Admin: loans & rates", "Every loan in one place, recalculated each time this page opens using today's date and the current Fed Funds rate. Changes save immediately and are logged with who made them.");
    const body = h("div");
    s.append(body);
    const act = async (payload, msg) => {
      try { st = await api("/api/loans", payload); draw(); if (msg) toast(s, msg); }
      catch (e) { toast(s, e.message, "err"); }
    };

    function draw() {
      const T = st.totals, fed = st.fed, feed = st.feed;
      const calc = Object.fromEntries(st.rows.map((r) => [r.id, r]));
      const open = st.loans.filter((l) => (l.status || "open") === "open");
      const closed = st.loans.filter((l) => l.status === "closed");
      body.replaceChildren();

      // Fed Funds
      const fedCard = h("div", { class: "ws-fed" },
        h("div", {}, h("div", { class: "kpi-label" }, "Fed Funds target range"),
          h("div", { class: "ws-fed-big" }, fed.upper == null ? "Unavailable" : `${pct(fed.lower)} – ${pct(fed.upper)}`),
          h("div", { class: "kpi-sub" }, fed.overridden ? `Manual override by ${who(st.fedOverride.setBy)}, ${fmtWhen(st.fedOverride.setAt)}. Live feed shows ${pct(feed.lower)} – ${pct(feed.upper)}.`
            : `Floating loans use the upper limit, ${pct(fed.upper)}. Effective rate ${pct(feed.effr)} on ${fmtDate(feed.effectiveDate)}.`)),
        h("div", { class: "ws-fed-meta" },
          h("p", { class: "note" }, `Source: New York Fed. Checked automatically every morning and whenever this page opens; last checked ${fmtWhen(feed.fetchedAt)}.`),
          feed.error ? h("p", { class: "note warn-text" }, feed.error) : null,
          h("div", { class: "ws-row-btns" },
            h("button", { class: "btn-small", type: "button", onclick: () => act({ op: "refreshFed" }, "Checked the New York Fed.") }, "Check now"),
            fed.overridden ? h("button", { class: "link-button dark", type: "button", onclick: () => act({ op: "fedOverride", upper: "" }, "Override cleared; using the live rate.") }, "Clear override")
              : h("button", { class: "link-button dark", type: "button", onclick: () => {
                const v = prompt("Use a manual Fed Funds upper limit (%) instead of the live feed, e.g. 4.25", fed.upper);
                if (v != null && v.trim() !== "") act({ op: "fedOverride", upper: v, lower: Number(v) - 0.25 }, "Override set.");
              } }, "Set manual override"))));
      body.append(section("Fed Funds rate"), fedCard);
      const margins = open.filter((l) => l.rateType === "floating");
      if ((feed.history || []).length) {
        const hist = feed.history.slice().reverse().slice(0, 8);
        body.append(h("div", { class: "sheet-scroll" }, h("table", { class: "grid dgrid ws-narrow" },
          h("thead", {}, h("tr", {}, h("th", {}, "Target changed"), h("th", { class: "num" }, "Range"), ...margins.map((l) => h("th", { class: "num" }, `${l.name.split(",")[0]} rate`)))),
          h("tbody", {}, hist.map((x) => h("tr", {}, h("td", {}, fmtDate(x.date)), h("td", { class: "num" }, `${pct(x.lower)} – ${pct(x.upper)}`), ...margins.map((l) => h("td", { class: "num" }, pct(x.upper + Number(l.spread || 0))))))))));
      }

      // Totals
      body.append(section("All open loans"), h("div", { class: "kpis" },
        [["Total debt", usd(T.balance), `${T.count} open loan${T.count === 1 ? "" : "s"}`, true], ["Weighted rate", pct(T.weightedRate), `${usd(T.floatingBalance)} floating`],
          ["Interest, next 12 months", usd(T.annualInterest), "at today's rates"], ["Monthly payments", usd(T.monthlyService), "incl. escrow and margin interest"]]
          .map(([l, v, sub, lead]) => h("div", { class: "kpi" + (lead ? " kpi--lead" : "") }, h("div", { class: "kpi-label" }, l), h("div", { class: "kpi-value" }, v), h("div", { class: "kpi-sub" }, sub)))));

      open.forEach((l) => body.append(loanCard(l, calc[l.id])));

      // Sensitivity
      if (margins.length) {
        const base = st.scenarios.find((x) => x.shift === 0);
        body.append(section("If the Fed moves", "Interest over the next 12 months on all open loans; only floating-rate loans change."),
          h("div", { class: "sheet-scroll" }, h("table", { class: "grid dgrid ws-narrow" },
            h("thead", {}, h("tr", {}, ["Fed move", "Fed upper", ...margins.map((l) => `${l.name.split(",")[0]} rate`), "Annual interest", "Change"].map((x, i) => h("th", { class: i ? "num" : null }, x)))),
            h("tbody", {}, st.scenarios.map((sc) => h("tr", { class: sc.shift === 0 ? "sum" : null },
              h("td", {}, sc.shift === 0 ? "Today" : `${sc.shift > 0 ? "+" : "−"}${Math.abs(sc.shift * 100)} bp`), h("td", { class: "num" }, pct(sc.fedUpper)),
              ...margins.map((l) => h("td", { class: "num" }, pct((sc.floatingRates.find((f) => f.id === l.id) || {}).rate))),
              h("td", { class: "num" }, usd(sc.annualInterest)), h("td", { class: "num" + (sc.annualInterest - base.annualInterest > 0 ? " neg" : "") }, sc.shift === 0 ? "—" : usd(sc.annualInterest - base.annualInterest))))))));
      }

      // Add loan
      const addD = h("details", { class: "ws-add" }, h("summary", {}, h("strong", {}, "Add a loan")));
      addD.append(loanForm({ kind: "amortizing", rateType: "fixed", openedDate: today() }, (loan, startBalance) => act({ op: "add", loan }, "Loan added.").then(async () => {
        if (startBalance && startBalance.value !== "") { const added = st.loans[st.loans.length - 1]; if (added) await act({ op: "balance", id: added.id, value: startBalance.value, asOf: startBalance.asOf }); }
      }), true));
      body.append(addD);

      if (closed.length) {
        body.append(section(`Closed loans (${closed.length})`));
        body.append(h("ul", { class: "jason" }, closed.map((l) => h("li", {}, h("strong", {}, l.name), ` — ${l.lender || ""}, closed ${fmtDate(l.closedDate)}${l.closeNote ? `: ${l.closeNote}` : ""} `,
          h("button", { class: "link-button dark", type: "button", onclick: () => act({ op: "reopen", id: l.id }, "Reopened.") }, "Reopen"), " ",
          h("button", { class: "link-button dark danger", type: "button", onclick: () => { if (confirm(`Delete ${l.name} and its history permanently?`)) act({ op: "delete", id: l.id }, "Deleted."); } }, "Delete")))));
      }
    }

    function loanCard(l, c) {
      const card = h("div", { class: "ws-loan" });
      const rateDesc = l.rateType === "floating" ? `Fed upper ${pct(st.fed.upper)} + ${pct(l.spread)}` : "Fixed";
      const facts = l.kind === "amortizing"
        ? [["Balance", usd(c.balance), c.balanceBasis === "schedule" ? "per amortization schedule" : c.balanceBasis], ["Rate", pct(c.rate), rateDesc],
          ["Payment (P&I)", usd(c.payment, 2), c.escrow ? `+ ${usd(c.escrow, 2)} escrow = ${usd(c.monthlyService, 2)}` : "monthly"], ["Next payment", fmtDate(c.nextPayment), `${c.paymentsMade} made`],
          ["Maturity", fmtDate(l.maturityDate), `${c.paymentsToMaturity} payments left`], ["Balloon due", usd(c.balloon), fmtDate(l.maturityDate)],
          ["Interest, next 12 mo", usd(c.annualInterest), `${usd(c.monthlyInterest)} this month`]]
        : [["Balance", usd(c.balance), c.balanceBasis], ["Rate", pct(c.rate), rateDesc], ["Interest per month", usd(c.monthlyInterest), `${usd(c.dailyInterest, 2)} a day, ${c.dayBasis}-day year`],
          ["Interest, next 12 mo", usd(c.annualInterest), "at today's balance and rate"], ...(l.rateType === "floating" ? [["Each 0.25% Fed move", usd(c.per25bp), "per year"]] : [])];
      const panel = h("div");
      const showView = () => panel.replaceChildren();
      card.append(
        h("div", { class: "ws-loan-head" }, h("div", {}, h("h3", {}, l.name), h("div", { class: "muted small" }, [l.lender, kindLabel(l.kind), l.rateType === "floating" ? "Floating rate" : "Fixed rate", l.openedDate ? `opened ${fmtDate(l.openedDate)}` : null, l.secures ? `secured by ${securesLabel(l.secures)}` : null].filter(Boolean).join(" · "))),
          h("div", { class: "ws-actions" },
            h("button", { class: "btn-small", type: "button", onclick: () => panel.replaceChildren(balanceForm()) }, "Update balance"),
            h("button", { class: "link-button dark", type: "button", onclick: () => panel.replaceChildren(loanForm(l, (loan) => act({ op: "update", id: l.id, loan }, "Saved."), false, showView)) }, "Edit terms"),
            h("button", { class: "link-button dark", type: "button", onclick: () => panel.replaceChildren(closeForm()) }, "Close loan"),
            h("button", { class: "link-button dark danger", type: "button", onclick: () => { if (confirm(`Delete ${l.name} permanently? To keep its record, use Close loan instead.`)) act({ op: "delete", id: l.id }, "Deleted."); } }, "Delete"))),
        c.error ? h("p", { class: "note warn-text" }, c.error) : h("div", { class: "ws-facts" }, facts.map(([k, v, sub]) => h("div", {}, h("div", { class: "kpi-label" }, k), h("div", { class: "ws-fact" }, v), h("div", { class: "kpi-sub" }, sub)))),
        panel,
        l.notes ? h("p", { class: "note" }, l.notes) : null,
        (l.history || []).length ? h("details", { class: "lots" }, h("summary", {}, `Change log (${l.history.length})`), h("ul", { class: "jason small" }, l.history.slice().reverse().map((x) => h("li", {}, `${fmtWhen(x.at)} · ${who(x.by)} · ${x.change}`)))) : null);

      function balanceForm() {
        const auto = l.kind === "margin" && l.autoBalance;
        const v = h("input", { type: "number", step: "0.01", value: l.balanceOverride ? l.balanceOverride.value : (c.balance || "") });
        const d = h("input", { type: "date", value: today() });
        return h("div", { class: "ws-edit" },
          h("p", { class: "note" }, auto ? "This balance updates automatically from each Schwab positions upload. Entering one here only applies if you turn off automatic updates under Edit terms."
            : l.kind === "amortizing" ? "Enter the balance from the lender's statement. Later scheduled payments are applied automatically. Clear it to go back to the schedule." : "Enter the current outstanding balance."),
          h("div", { class: "tax-form" }, field("Balance $", v), field("As of", d)),
          h("div", { class: "ws-row-btns" },
            h("button", { class: "btn-small", type: "button", onclick: () => act({ op: "balance", id: l.id, value: v.value, asOf: d.value }, "Balance updated.") }, "Save balance"),
            l.balanceOverride ? h("button", { class: "link-button dark", type: "button", onclick: () => act({ op: "balance", id: l.id, value: "" }, "Using the schedule again.") }, "Clear entered balance") : null,
            h("button", { class: "link-button dark", type: "button", onclick: showView }, "Cancel")));
      }
      function closeForm() {
        const d = h("input", { type: "date", value: today() }), n = h("input", { placeholder: "e.g. Paid off at refinance" });
        return h("div", { class: "ws-edit" }, h("p", { class: "note" }, "Closed loans leave the totals but keep their terms and change log."),
          h("div", { class: "tax-form" }, field("Closed on", d), field("Note", n)),
          h("div", { class: "ws-row-btns" }, h("button", { class: "btn-small", type: "button", onclick: () => act({ op: "close", id: l.id, date: d.value, note: n.value }, "Loan closed.") }, "Close loan"),
            h("button", { class: "link-button dark", type: "button", onclick: showView }, "Cancel")));
      }
      return card;
    }

    function loanForm(l, onSave, isNew, onCancel) {
      const I = {
        name: h("input", { value: l.name || "" }), lender: h("input", { value: l.lender || "" }),
        kind: select(KINDS, l.kind), rateType: select([["fixed", "Fixed"], ["floating", "Floating: Fed Funds upper + spread"]], l.rateType),
        fixedRate: h("input", { type: "number", step: "0.001", value: l.fixedRate ?? "" }), spread: h("input", { type: "number", step: "0.001", value: l.spread ?? "" }),
        originalPrincipal: h("input", { type: "number", step: "0.01", value: l.originalPrincipal ?? "" }), amortMonths: h("input", { type: "number", step: "1", value: l.amortMonths ?? "" }),
        firstPaymentDate: h("input", { type: "date", value: l.firstPaymentDate || "" }), maturityDate: h("input", { type: "date", value: l.maturityDate || "" }),
        openedDate: h("input", { type: "date", value: l.openedDate || "" }), escrowMonthly: h("input", { type: "number", step: "0.01", value: l.escrowMonthly ?? "" }),
        paymentOverride: h("input", { type: "number", step: "0.01", value: l.paymentOverride ?? "", placeholder: "Calculated if blank" }),
        autoBalance: h("input", { type: "checkbox" }), notes: h("textarea", { rows: 3 }),
        secures: select(securesOptions(), l.secures || (l.kind === "margin" ? "portfolio" : "")),
      };
      I.autoBalance.checked = !!l.autoBalance; I.notes.value = l.notes || "";
      const startBal = h("input", { type: "number", step: "0.01" }), startAsOf = h("input", { type: "date", value: today() });
      const wrap = (k, label, hint) => { const f = field(label, I[k], hint); f.dataset.k = k; return f; };
      const grid = h("div", { class: "tax-form" },
        wrap("name", "Name"), wrap("lender", "Lender"), wrap("kind", "Type"), wrap("rateType", "Rate"),
        wrap("fixedRate", "Fixed rate %"), wrap("spread", "Spread over Fed Funds upper %", "Schwab margin: 0.75"),
        wrap("originalPrincipal", "Original principal $"), wrap("amortMonths", "Amortization (months)", "25 years = 300"),
        wrap("firstPaymentDate", "First payment date"), wrap("maturityDate", "Maturity / balloon date"), wrap("openedDate", "Opened"),
        wrap("escrowMonthly", "Monthly escrow $", "Taxes and insurance, if escrowed"), wrap("paymentOverride", "Monthly P&I override $"),
        wrap("secures", "Secured by", "Ties the loan to an asset on the Overview and Cash Flow tabs"));
      const autoRow = h("label", { class: "tax-field tax-check" }, I.autoBalance, h("span", {}, "Update the balance automatically from Schwab positions uploads"));
      const startRow = isNew ? h("div", { class: "tax-form", "data-start": "1" }, field("Current balance $", startBal, "For margin, interest-only and credit lines"), field("Balance as of", startAsOf)) : null;
      const sync = () => {
        const kind = I.kind.value, floating = I.rateType.value === "floating", amort = kind === "amortizing";
        grid.querySelectorAll("[data-k]").forEach((el) => {
          const k = el.dataset.k;
          el.hidden = (k === "fixedRate" && floating) || (k === "spread" && !floating) || (!amort && ["originalPrincipal", "amortMonths", "firstPaymentDate", "escrowMonthly", "paymentOverride"].includes(k));
        });
        autoRow.hidden = kind !== "margin";
        if (startRow) startRow.hidden = amort || (kind === "margin" && I.autoBalance.checked);
      };
      [I.kind, I.rateType, I.autoBalance].forEach((el) => el.addEventListener("change", sync));
      const form = h("div", { class: "ws-edit" }, grid, autoRow, startRow, field("Notes", I.notes),
        h("div", { class: "ws-row-btns" },
          h("button", { class: "btn-small", type: "button", onclick: () => {
            const loan = Object.fromEntries(Object.entries(I).map(([k, el]) => [k, el.type === "checkbox" ? el.checked : el.value]));
            if (!loan.name.trim()) { toast(s, "Give the loan a name.", "err"); return; }
            onSave(loan, isNew ? { value: startBal.value, asOf: startAsOf.value } : null);
          } }, isNew ? "Add loan" : "Save changes"),
          onCancel ? h("button", { class: "link-button dark", type: "button", onclick: onCancel }, "Cancel") : null));
      sync();
      return form;
    }

    draw();
    root.replaceChildren(s);
  }

  window.BSWork = {
    tabs: [
      { slug: "discussion", name: "Discussion Topics", replaces: "discussion-topics" },
      { slug: "watch", name: "Watch Items", replaces: "watch-items" },
      { slug: "documents", name: "Documents" },
      { slug: "admin", name: "Admin" },
    ],
    render(slug, root) {
      ({ discussion: (r) => renderBoard(r, "discussion"), watch: (r) => renderBoard(r, "watch"), documents: renderDocs, admin: renderAdmin })[slug](root);
    },
  };
})();
