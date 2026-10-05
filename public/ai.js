// AI Assistant tab: chat with Claude about the account, properties and loans; attach PDF, Excel,
// Word, PowerPoint, CSV or image files; approve each change before it's saved.
(function () {
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
  const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

  document.head.append(Object.assign(document.createElement("style"), { textContent: `
.ai { display: flex; flex-direction: column; min-height: 70vh; }
.ai-top { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
.ai-top .grow { flex: 1; }
.ai-hist { position: relative; }
.ai-hist summary { list-style: none; cursor: pointer; }
.ai-hist summary::-webkit-details-marker { display: none; }
.ai-hist-list { position: absolute; right: 0; z-index: 20; background: #fff; border: 1px solid #c9d4e3; border-radius: 8px; box-shadow: 0 10px 30px rgba(12, 28, 54, 0.18); width: min(360px, 86vw); max-height: 60vh; overflow: auto; padding: 0.35rem; }
.ai-hist-item { display: flex; gap: 0.4rem; align-items: center; padding: 0.45rem 0.5rem; border-radius: 6px; }
.ai-hist-item:hover { background: #f1f4f9; }
.ai-hist-item button.t { flex: 1; text-align: left; background: none; border: 0; font: inherit; color: #0c1c36; cursor: pointer; padding: 0; }
.ai-hist-item small { color: #6a7a94; white-space: nowrap; }
.ai-log { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; padding: 0.25rem 0 1rem; }
.ai-msg { max-width: 100%; line-height: 1.5; font-size: 0.95rem; }
.ai-msg.user { align-self: flex-end; background: #0c1c36; color: #eef3f8; padding: 0.6rem 0.85rem; border-radius: 14px 14px 4px 14px; max-width: 85%; white-space: pre-wrap; }
.ai-msg.user .files { margin-top: 0.35rem; font-size: 0.8rem; color: #c9a262; }
.ai-msg.assistant { align-self: stretch; color: #182b4a; }
.ai-msg.assistant p { margin: 0 0 0.6rem; }
.ai-msg.assistant ul, .ai-msg.assistant ol { margin: 0 0 0.6rem; padding-left: 1.2rem; }
.ai-msg.assistant li { margin: 0.2rem 0; }
.ai-msg.assistant h3, .ai-msg.assistant h4 { margin: 0.8rem 0 0.35rem; font-size: 1rem; }
.ai-msg.assistant code { background: #eef1f6; padding: 0.05rem 0.3rem; border-radius: 4px; font-size: 0.88em; }
.ai-msg.assistant .tbl { overflow-x: auto; margin: 0 0 0.7rem; }
.ai-msg.assistant table { border-collapse: collapse; font-size: 0.85rem; min-width: 60%; }
.ai-msg.assistant th, .ai-msg.assistant td { border-bottom: 1px solid #dfe5ee; padding: 0.35rem 0.6rem; text-align: left; }
.ai-msg.assistant td.n, .ai-msg.assistant th.n { text-align: right; font-variant-numeric: tabular-nums; }
.ai-tool { align-self: flex-start; font-size: 0.8rem; color: #4a5b78; background: #eef1f6; border-radius: 999px; padding: 0.2rem 0.65rem; }
.ai-tool.write { background: #fff5cc; color: #6b4f00; }
.ai-tool.declined { background: #f3f4f6; color: #8a99b2; text-decoration: line-through; }
.ai-tool.error { background: #fde8e6; color: #9b1c12; }
.ai-tool.done.write { background: #e3f3e9; color: #1f5f3a; }
.ai-card { border: 1px solid #e3c98f; background: #fffaf0; border-radius: 10px; padding: 0.85rem 1rem; }
.ai-card h4 { margin: 0 0 0.5rem; font-size: 0.95rem; }
.ai-change { border-top: 1px solid #f0e2c0; padding: 0.55rem 0; }
.ai-change:first-of-type { border-top: 0; }
.ai-change label { display: flex; gap: 0.5rem; align-items: flex-start; font-weight: 500; cursor: pointer; }
.ai-change label input { margin-top: 0.25rem; }
.ai-change dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.8rem; margin: 0.4rem 0 0 1.6rem; font-size: 0.8rem; color: #4a5b78; }
.ai-change dt { color: #6a7a94; }
.ai-change dd { margin: 0; word-break: break-word; }
.ai-card .btns { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; }
.ai-working { align-self: flex-start; font-size: 0.85rem; color: #6a7a94; display: flex; align-items: center; gap: 0.5rem; }
.ai-dots span { display: inline-block; width: 6px; height: 6px; margin: 0 1px; border-radius: 50%; background: #c9a262; animation: aiB 1.2s infinite ease-in-out; }
.ai-dots span:nth-child(2) { animation-delay: 0.15s; } .ai-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes aiB { 0%, 80%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
.ai-sugg { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.25rem 0 1rem; }
.ai-sugg button { font: inherit; font-size: 0.85rem; border: 1px solid #c9d4e3; background: #fff; color: #183763; border-radius: 999px; padding: 0.4rem 0.8rem; cursor: pointer; text-align: left; }
.ai-sugg button:hover { border-color: #c9a262; }
.ai-compose { position: sticky; bottom: 0; background: #f7f9fc; padding: 0.6rem 0 calc(0.4rem + env(safe-area-inset-bottom, 0px)); border-top: 1px solid #dfe5ee; }
.ai-row { display: flex; gap: 0.5rem; align-items: flex-end; }
.ai-row textarea { flex: 1; font: inherit; font-size: 16px; line-height: 1.4; border: 1px solid #c9d4e3; border-radius: 10px; padding: 0.6rem 0.75rem; resize: none; min-height: 2.75rem; max-height: 40vh; color: #0c1c36; background: #fff; }
.ai-row textarea:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(201, 162, 98, 0.25); }
.ai-attach { font: inherit; border: 1px solid #c9d4e3; background: #fff; border-radius: 10px; width: 2.75rem; height: 2.75rem; cursor: pointer; font-size: 1.2rem; color: #183763; flex: none; }
.ai-send { height: 2.75rem; flex: none; }
.ai-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.4rem; }
.ai-chip { font-size: 0.8rem; background: #fff; border: 1px solid #c9d4e3; border-radius: 999px; padding: 0.2rem 0.3rem 0.2rem 0.65rem; display: inline-flex; gap: 0.35rem; align-items: center; }
.ai-chip.err { border-color: #e4a39b; color: #9b1c12; }
.ai-chip button { border: 0; background: none; cursor: pointer; color: #6a7a94; font-size: 1rem; line-height: 1; }
.ai-err { color: #9b1c12; font-size: 0.85rem; margin: 0.3rem 0; }
.ai-setup { background: #fff; border: 1px dashed #c9d4e3; border-radius: 8px; padding: 1rem 1.2rem; }
` }));

  /* ---------------- markdown (escaped first, then a small safe subset) ---------------- */
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  function md(text) {
    const lines = String(text).replace(/\r/g, "").split("\n");
    let html = "", i = 0;
    const isNum = (c) => /^[\s$−\-+()%.,0-9×]*\d[\s$−\-+()%.,0-9×MK]*$/.test(c.trim());
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = cells(l); i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        const num = head.map((_, j) => rows.length && rows.every((r) => !r[j] || isNum(r[j])));
        html += `<div class="tbl"><table><thead><tr>${head.map((c, j) => `<th class="${num[j] ? "n" : ""}">${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, j) => `<td class="${num[j] ? "n" : ""}">${inline(r[j] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        continue;
      }
      let m;
      if ((m = l.match(/^(#{1,4})\s+(.*)/))) { html += `<h${m[1].length > 2 ? 4 : 3}>${inline(m[2])}</h${m[1].length > 2 ? 4 : 3}>`; i++; continue; }
      if (/^\s*[-*•]\s+/.test(l)) { html += "<ul>"; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-*•]\s+/, ""))}</li>`; html += "</ul>"; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { html += "<ol>"; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`; html += "</ol>"; continue; }
      if (!l.trim()) { i++; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
      if (!para.length) para.push(lines[i++]);
      html += `<p>${para.map(inline).join("<br>")}</p>`;
    }
    return html;
  }

  /* ---------------- API ---------------- */
  async function api(body) {
    const r = await fetch("/api/ai" + (body ? "" : ""), body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(out.error || "Something went wrong. Try again."), { data: out });
    return out;
  }
  const getJson = (q) => fetch("/api/ai" + q, { credentials: "same-origin" }).then(async (r) => {
    if (r.status === 401) { location.replace("/"); throw new Error("signed out"); }
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(o.error || "Couldn't load.");
    return o;
  });

  /* ---------------- attachments ---------------- */
  const libs = {};
  const loadLib = (key, src, ready) => {
    if (ready()) return Promise.resolve(ready());
    if (!libs[key]) libs[key] = new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = src;
      sc.onload = () => res(ready()); sc.onerror = () => { libs[key] = null; rej(new Error("A file reader didn't load. Check the connection and try again.")); };
      document.head.append(sc);
    });
    return libs[key];
  };
  const XLSX = () => loadLib("xlsx", "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", () => window.XLSX);
  const MAMMOTH = () => loadLib("mammoth", "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js", () => window.mammoth);
  const JSZIP = () => loadLib("jszip", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", () => window.JSZip);
  const MAX_TEXT = 300000;
  const cut = (t) => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + "\n[truncated: file is longer]" : t);

  async function imageToJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This image format can't be read here. Save it as JPEG or PNG and try again.")); i.src = url; });
      const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
    } finally { URL.revokeObjectURL(url); }
  }
  // Turn a picked file into what the server needs: a PDF/image to attach directly, or extracted text.
  async function prepare(file) {
    const name = file.name, ext = (name.split(".").pop() || "").toLowerCase(), type = file.type || "";
    if (ext === "pdf" || type === "application/pdf") return { kind: "pdf", mediaType: "application/pdf", blob: file };
    if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"].includes(ext)) return { kind: "image", mediaType: "image/jpeg", blob: await imageToJpeg(file), name: name.replace(/\.(heic|heif|png|webp|gif)$/i, ".jpg") };
    if (["xlsx", "xlsm", "xls", "ods"].includes(ext)) {
      const X = await XLSX();
      const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const text = wb.SheetNames.map((n) => `## Sheet: ${n}\n${X.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false, dateNF: "yyyy-mm-dd" })}`).join("\n\n");
      return { kind: "text", text: cut(text), blob: file };
    }
    if (["csv", "txt", "md", "json", "tsv", "xml"].includes(ext) || type.startsWith("text/")) return { kind: "text", text: cut(await file.text()), blob: file };
    if (ext === "docx") {
      const M = await MAMMOTH();
      const r = await M.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return { kind: "text", text: cut(r.value), blob: file };
    }
    if (ext === "pptx") {
      const Z = await JSZIP();
      const zip = await Z.loadAsync(await file.arrayBuffer());
      const num = (p) => +(p.match(/(\d+)\.xml$/) || [0, 0])[1];
      const pick = (re) => Object.keys(zip.files).filter((p) => re.test(p)).sort((a, b) => num(a) - num(b));
      const textOf = (xml) => xml.split(/<\/a:p>/).map((p) => (p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, "")).join("")).filter((s) => s.trim()).join("\n")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const notes = {};
      for (const p of pick(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) notes[num(p)] = textOf(await zip.file(p).async("string"));
      const parts = [];
      for (const p of pick(/^ppt\/slides\/slide\d+\.xml$/)) { const n = num(p); parts.push(`## Slide ${n}\n${textOf(await zip.file(p).async("string"))}${notes[n] ? `\n[Speaker notes] ${notes[n]}` : ""}`); }
      return { kind: "text", text: cut(parts.join("\n\n")), blob: file };
    }
    if (["doc", "ppt"].includes(ext)) throw new Error(`Older .${ext} files can't be read. Save it as .${ext}x or PDF and attach that.`);
    throw new Error("This file type isn't supported. Attach PDF, Excel, Word, PowerPoint, CSV, text or an image.");
  }
  function putFile(url, blob, mediaType, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", mediaType || blob.type || "application/octet-stream");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status}).`)));
      x.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
      x.send(blob);
    });
  }

  /* ---------------- state ---------------- */
  let convId = (() => { try { return sessionStorage.getItem("bs-ai-conv") || null; } catch { return null; } })();
  let conv = null;          // last server reply
  let attachments = [];     // { id, name, status, progress, ready: {path,...} | null, error }
  let busy = false, working = "", errMsg = "", configured = null, history = [];
  let draft = "";
  let rootEl = null;
  const setConv = (id) => { convId = id; try { id ? sessionStorage.setItem("bs-ai-conv", id) : sessionStorage.removeItem("bs-ai-conv"); } catch {} };
  const currentTab = () => decodeURIComponent(location.hash.replace(/^#/, "")) || "ai";

  function notifyChanged(list) {
    if (list && list.length) window.dispatchEvent(new CustomEvent("bs:data-changed", { detail: list }));
  }

  async function runLoop(first) {
    let r = first;
    for (let guard = 0; r && r.status === "continue" && guard < 40; guard++) {
      conv = r; notifyChanged(r.changed); paint();
      const lastTool = [...r.display].reverse().find((d) => d.role === "tool");
      working = lastTool ? `${lastTool.label}…` : "Thinking…";
      paint();
      r = await api({ op: "continue", id: r.id, context: { tab: "AI Assistant" } });
    }
    if (r) { conv = r; notifyChanged(r.changed); }
  }
  async function guarded(fn) {
    busy = true; errMsg = ""; working = working || "Thinking…"; paint();
    try { await fn(); }
    catch (e) { if (e.message !== "signed out") { errMsg = e.message; if (e.data && e.data.display) conv = e.data; } }
    finally { busy = false; working = ""; paint(); refreshHistory(); }
  }

  async function send(text) {
    if (busy) return;
    const pendingUploads = attachments.filter((a) => a.status === "uploading" || a.status === "reading");
    if (pendingUploads.length) { errMsg = "Wait for the attachments to finish uploading."; paint(); return; }
    const files = attachments.filter((a) => a.ready).map((a) => a.ready);
    if (!text.trim() && !files.length) return;
    draft = "";
    const sentAtt = attachments; attachments = [];
    // Show the message right away.
    conv = conv && conv.id === convId ? { ...conv, display: conv.display.concat([{ role: "user", text, files: files.map((f) => f.name) }]), pending: null } : { id: null, display: [{ role: "user", text, files: files.map((f) => f.name) }] };
    working = files.length ? "Reading the attachments…" : "Thinking…";
    await guarded(async () => {
      try {
        const r = await api({ op: "send", id: convId || undefined, text, files, context: { tab: currentTab() } });
        setConv(r.id);
        await runLoop(r);
      } catch (e) { if (!convId) attachments = sentAtt; throw e; }
    });
  }
  async function decide(approve, decisions) {
    await guarded(async () => {
      working = approve ? "Saving…" : "Okay…";
      const r = await api({ op: "decide", id: convId, approve, decisions });
      notifyChanged(r.changed);
      await runLoop({ ...r, status: r.status });
    });
  }
  async function retry() {
    await guarded(async () => { const r = await api({ op: "continue", id: convId, context: { tab: "AI Assistant" } }); await runLoop(r); });
  }

  async function addFiles(list) {
    for (const file of list) {
      const a = { id: Math.random().toString(36).slice(2), name: file.name, status: "reading", progress: 0, ready: null };
      attachments.push(a); paint();
      (async () => {
        try {
          if (file.size > 30 * 1024 * 1024) throw new Error("over 30 MB");
          const p = await prepare(file);
          a.name = p.name || file.name;
          a.status = "uploading"; paint();
          const blob = p.blob;
          const sig = await api({ op: "sign", filename: a.name, size: blob.size });
          await putFile(sig.url, blob, p.kind === "text" ? file.type || "application/octet-stream" : p.mediaType, (x) => { a.progress = x; paintChips(); });
          a.ready = { path: sig.path, name: a.name, kind: p.kind, mediaType: p.kind === "text" ? "text/plain" : p.mediaType, originalType: p.kind === "text" ? file.type || "" : p.mediaType, size: blob.size, text: p.text };
          a.status = "ready";
        } catch (e) { a.status = "error"; a.error = e.message; }
        paint();
      })();
    }
  }

  async function refreshHistory() {
    try { const r = await getJson(""); history = r.items || []; configured = r.configured; paintHistory(); } catch {}
  }
  async function openConv(id) {
    await guarded(async () => { working = "Loading…"; const r = await getJson(`?id=${encodeURIComponent(id)}`); conv = r; setConv(r.id); });
  }
  function newChat() { setConv(null); conv = null; attachments = []; errMsg = ""; paint(); const ta = rootEl && rootEl.querySelector("textarea"); if (ta) ta.focus(); }

  /* ---------------- drawing ---------------- */
  let histEl = null, chipsEl = null, lastCount = 0;
  function paintHistory() {
    if (!histEl) return;
    histEl.replaceChildren(...(history.length ? history.map((x) => h("div", { class: "ai-hist-item" },
      h("button", { type: "button", class: "t", onclick: (e) => { e.target.closest("details").open = false; openConv(x.id); } }, x.title || "Untitled"),
      h("small", {}, fmtWhen(x.updatedAt)),
      h("button", { type: "button", class: "link-button danger", "aria-label": `Remove ${x.title}`, onclick: async () => { const r = await api({ op: "delete", id: x.id }); history = r.items; if (convId === x.id) newChat(); paintHistory(); } }, "Remove")))
      : [h("p", { class: "note", style: "padding:0.5rem" }, "No earlier chats yet.")]));
  }
  function paintChips() {
    if (!chipsEl) return;
    chipsEl.replaceChildren(...attachments.map((a) => h("span", { class: "ai-chip" + (a.status === "error" ? " err" : "") },
      a.status === "error" ? `${a.name}: ${a.error}` : a.status === "ready" ? `📎 ${a.name}` : a.status === "reading" ? `${a.name}: reading…` : `${a.name}: ${Math.round(a.progress * 100)}%`,
      h("button", { type: "button", "aria-label": `Remove ${a.name}`, onclick: () => { attachments = attachments.filter((x) => x !== a); paint(); } }, "×"))));
  }

  const SUGGEST = [
    "What happens if the market falls 25% over the next 6 months?",
    "What's our estimated annual income after margin interest?",
    "How far could the market drop before a margin call?",
    "Update the 5100 Main mortgage terms",
    "Summarize performance since inception against the benchmark",
  ];

  function approvalCard(pending) {
    const boxes = {};
    const card = h("div", { class: "ai-card", role: "group", "aria-label": "Changes to approve" },
      h("h4", {}, pending.length === 1 ? "Approve this change?" : `Approve these ${pending.length} changes?`),
      pending.map((w) => {
        const cb = h("input", { type: "checkbox", checked: true });
        boxes[w.id] = cb;
        return h("div", { class: "ai-change" },
          h("label", {}, pending.length > 1 ? cb : null, h("span", {}, h("span", { class: "muted small" }, `${w.label}: `), w.summary)),
          w.details && w.details.length ? h("details", {}, h("summary", { class: "note" }, "Details"), h("dl", {}, w.details.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))) : null);
      }));
    const yes = h("button", { type: "button", class: "btn-small" }, pending.length > 1 ? "Approve selected" : "Approve");
    const no = h("button", { type: "button", class: "btn-small ghost" }, "Decline");
    yes.addEventListener("click", () => decide(null, Object.fromEntries(pending.map((w) => [w.id, pending.length === 1 ? true : boxes[w.id].checked]))));
    no.addEventListener("click", () => decide(false));
    card.append(h("div", { class: "btns" }, yes, no), h("p", { class: "note" }, "Nothing is saved until you approve. Every change is recorded with your name, like a change made by hand."));
    return card;
  }

  function paint() {
    if (!rootEl || !document.body.contains(rootEl)) return;
    const hadFocus = document.activeElement && document.activeElement.tagName === "TEXTAREA" && rootEl.contains(document.activeElement);
    const selEnd = hadFocus ? document.activeElement.selectionEnd : null;
    const s = h("article", { class: "sheet dash ws ai" });
    const top = h("div", { class: "ai-top" }, h("h2", { class: "grow", style: "margin:0" }, "AI Assistant"));
    const hist = h("details", { class: "ai-hist" }, h("summary", { class: "btn-small ghost" }, "History"));
    histEl = h("div", { class: "ai-hist-list" });
    hist.append(histEl);
    top.append(hist, h("button", { type: "button", class: "btn-small", onclick: newChat, disabled: busy }, "New chat"));
    s.append(top);
    paintHistory();

    if (configured === false) s.append(h("div", { class: "ai-setup" }, h("strong", {}, "One step to turn this on. "),
      "Add an Anthropic API key to the site: in Vercel, open the bluesky-website project → Settings → Environment Variables, add ANTHROPIC_API_KEY (from console.anthropic.com), then redeploy."));

    const log = h("div", { class: "ai-log", "aria-live": "polite" });
    const items = (conv && conv.display) || [];
    if (!items.length) {
      log.append(h("p", { class: "lede", style: "margin:0" }, "Ask about the account, the properties or the loans, run what-if scenarios, or attach a statement, spreadsheet, document, deck or photo. It can make any change you can make in the app; you approve each one before it's saved."),
        h("div", { class: "ai-sugg" }, SUGGEST.map((q) => h("button", { type: "button", disabled: busy, onclick: () => send(q) }, q))));
    }
    for (const d of items) {
      if (d.role === "user") log.append(h("div", { class: "ai-msg user" }, d.text, d.files && d.files.length ? h("div", { class: "files" }, "📎 " + d.files.join(", ")) : null));
      else if (d.role === "assistant") { const div = h("div", { class: "ai-msg assistant" }); div.innerHTML = md(d.text); log.append(div); }
      else if (d.role === "tool") {
        const st = d.status === "approved" ? "done" : d.status;
        const txt = d.write ? `${d.label}: ${d.summary || ""}${st === "done" ? " ✓ saved" : st === "declined" ? " (declined)" : st === "error" ? ` — not saved: ${d.error || "error"}` : " (waiting for approval)"}` : `${d.label}${d.summary ? `: ${d.summary}` : ""}${st === "error" ? " (failed)" : ""}`;
        log.append(h("div", { class: `ai-tool ${d.write ? "write" : ""} ${st}` }, txt));
      }
    }
    if (conv && conv.pending && conv.pending.length && !busy) log.append(approvalCard(conv.pending));
    if (busy) log.append(h("div", { class: "ai-working" }, h("span", { class: "ai-dots" }, h("span"), h("span"), h("span")), working || "Thinking…"));
    if (errMsg) log.append(h("div", {}, h("p", { class: "ai-err" }, errMsg), conv && conv.id && conv.status === "error" ? h("button", { type: "button", class: "btn-small ghost", onclick: retry }, "Try again") : null));
    s.append(log);

    // composer
    const ta = h("textarea", { rows: 1, placeholder: conv && conv.pending ? "Or type to change the request…" : "Ask anything, or tell it what to update…", "aria-label": "Message" });
    ta.value = draft;
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + "px"; };
    ta.addEventListener("input", () => { draft = ta.value; grow(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) { e.preventDefault(); send(ta.value); } });
    const file = h("input", { type: "file", multiple: true, hidden: true, accept: ".pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.md,.json,.docx,.pptx,image/*" });
    file.addEventListener("change", () => { addFiles([...file.files]); file.value = ""; });
    const attach = h("button", { type: "button", class: "ai-attach", "aria-label": "Attach files", title: "Attach PDF, Excel, Word, PowerPoint, CSV or image", onclick: () => file.click() }, "📎");
    const sendBtn = h("button", { type: "button", class: "btn-small ai-send", disabled: busy, onclick: () => send(ta.value) }, "Send");
    chipsEl = h("div", { class: "ai-chips" });
    paintChips();
    const comp = h("div", { class: "ai-compose" }, chipsEl, h("div", { class: "ai-row" }, attach, ta, sendBtn), file);
    comp.addEventListener("dragover", (e) => { e.preventDefault(); });
    comp.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
    s.append(comp);
    rootEl.replaceChildren(s);
    const count = items.length + (busy ? 1 : 0) + (conv && conv.pending ? 1 : 0);
    const scroll = count !== lastCount && items.length;
    lastCount = count;
    requestAnimationFrame(() => { grow(); if (scroll) comp.scrollIntoView({ block: "end" }); if (hadFocus) { ta.focus(); try { ta.setSelectionRange(selEnd, selEnd); } catch {} } });
  }

  async function render(slug, root) {
    rootEl = root;
    paint();
    refreshHistory();
    if (convId && (!conv || conv.id !== convId)) {
      try { conv = await getJson(`?id=${encodeURIComponent(convId)}`); } catch { setConv(null); conv = null; }
      paint();
      if (conv && conv.status === "continue") guarded(() => runLoop(conv));
    }
  }

  window.BSAI = { tabs: [{ slug: "ai", name: "AI Assistant" }], render };
})();
