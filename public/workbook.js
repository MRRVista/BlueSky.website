// Reads the 5100 Main report workbook (.xlsx) in the browser and turns it into the report JSON
// served by /api/report. Port of tools/extract.py: same cell text, number formats, bold and fill kinds.
(function (root) {
  const BUILTIN = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
    5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
    14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm",
    37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)", 39: "#,##0.00_);(#,##0.00)", 40: "#,##0.00_);[Red](#,##0.00)",
    41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
    43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_)_("$"* \\(#,##0.00\\)_("$"* "-"??_)_(@_)',
    45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
  };
  const KINDS = { FF1F4E79: "sec", FF7B2C2C: "warn", FFDDEBF7: "input", FFFFFF00: "hl", FFFFC000: "hl", FF92D050: "good", FFFCE4D6: "note" };

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const kids = (node, name) => (node ? Array.from(node.childNodes).filter((n) => n.nodeType === 1 && (n.localName || n.nodeName.split(":").pop()) === name) : []);
  const kid = (node, name) => kids(node, name)[0] || null;
  const all = (node, name) => (node ? Array.from(node.getElementsByTagNameNS("*", name)) : []);
  const textOf = (si) => {
    // Shared/inline string: <t> directly, or rich-text runs <r><t>; phonetic runs (<rPh>) are skipped.
    const direct = kid(si, "t");
    if (direct) return direct.textContent;
    return kids(si, "r").map((r) => (kid(r, "t") ? kid(r, "t").textContent : "")).join("");
  };
  const isDateFormat = (f) => {
    if (!f || f === "General" || f === "@") return false;
    const s = f.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    return /[dmyhs]/i.test(s);
  };
  const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const fmt = (a, dec, comma = true) => a.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: comma });

  function fmtNum(v, f) {
    const neg = v < 0, a = Math.abs(v);
    let s;
    if (f.includes("%")) {
      const dec = f.includes(".") ? f.split(".")[1].split("%")[0].length : 0;
      s = fmt(a * 100, dec) + "%";
    } else if ((/0\.00/.test(f) && f.includes("#,##0")) || f === "#,##0.00") s = fmt(a, 2);
    else if (f.includes("#,##0")) s = fmt(a, 0);
    else if (f === "0.00") s = fmt(a, 2);
    else if (Math.abs(a - Math.round(a)) < 1e-9) s = a >= 1900 && a <= 2100 ? String(Math.round(a)) : fmt(Math.round(a), 0);
    else if (a < 10) s = fmt(a, 2);
    else s = fmt(a, 0);
    if (neg) {
      const paren = f.includes("(") && f.includes("#,##0") && !f.includes("%");
      return [paren ? `(${s})` : `−${s}`, true];
    }
    return [s, false];
  }

  function serialToText(n, date1904) {
    const ms = Math.round(((date1904 ? n + 1462 : n) - 25569) * 864e5);
    const d = new Date(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  }

  async function extract(buf, filename, env = {}) {
    const JSZip = env.JSZip || root.JSZip;
    const Parser = env.DOMParser || root.DOMParser;
    const zip = await JSZip.loadAsync(buf);
    const parse = async (path) => { const f = zip.file(path); return f ? new Parser().parseFromString(await f.async("string"), "application/xml") : null; };

    const wbx = await parse("xl/workbook.xml");
    if (!wbx) throw new Error("This isn't an Excel workbook (.xlsx).");
    const date1904 = all(wbx, "workbookPr").some((p) => ["1", "true"].includes(p.getAttribute("date1904")));
    const rels = {};
    all(await parse("xl/_rels/workbook.xml.rels"), "Relationship").forEach((r) => {
      const t = r.getAttribute("Target");
      rels[r.getAttribute("Id")] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    });

    const sst = all(await parse("xl/sharedStrings.xml"), "si").map(textOf);

    const st = await parse("xl/styles.xml");
    const numFmts = { ...BUILTIN };
    all(st, "numFmt").forEach((n) => { numFmts[+n.getAttribute("numFmtId")] = n.getAttribute("formatCode"); });
    const fonts = kids(kid(st && st.documentElement, "fonts"), "font").map((f) => { const b = kid(f, "b"); return !!b && !["0", "false"].includes(b.getAttribute("val")); });
    const fills = kids(kid(st && st.documentElement, "fills"), "fill").map((f) => {
      const p = kid(f, "patternFill");
      if (!p) return null;
      const type = p.getAttribute("patternType");
      if (!type || type === "none") return null;
      const fg = kid(p, "fgColor");
      return fg && fg.getAttribute("rgb") ? KINDS[fg.getAttribute("rgb").toUpperCase()] || null : null;
    });
    const xfs = kids(kid(st && st.documentElement, "cellXfs"), "xf").map((x) => ({
      fmt: numFmts[+(x.getAttribute("numFmtId") || 0)] || "General",
      bold: fonts[+(x.getAttribute("fontId") || 0)] || false,
      kind: fills[+(x.getAttribute("fillId") || 0)] || null,
    }));
    const xfOf = (i) => xfs[i] || { fmt: "General", bold: false, kind: null };

    const sheets = [];
    for (const sh of all(wbx, "sheet")) {
      const state = sh.getAttribute("state");
      if (state && state !== "visible") continue;
      const name = sh.getAttribute("name");
      const rid = sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || sh.getAttribute("r:id");
      const ws = await parse(rels[rid]);
      if (!ws) continue;

      const byRow = new Map();
      const used = new Set();
      let maxRow = 0;
      for (const row of all(ws, "row")) {
        const rn = +row.getAttribute("r");
        maxRow = Math.max(maxRow, rn);
        const cells = [];
        let auto = 0;
        for (const c of kids(row, "c")) {
          const ref = c.getAttribute("r");
          const col = ref ? colNum(ref) : auto + 1;
          auto = col;
          const t = c.getAttribute("t") || "n";
          const vNode = kid(c, "v");
          let v = null;
          if (t === "s") v = vNode ? sst[+vNode.textContent] : null;
          else if (t === "inlineStr") v = textOf(kid(c, "is"));
          else if (t === "str" || t === "e") v = vNode ? vNode.textContent : null;
          else if (t === "b") v = vNode ? (vNode.textContent === "1" ? "True" : "False") : null;
          else if (t === "d") v = vNode ? { iso: vNode.textContent } : null;
          else if (vNode && vNode.textContent !== "") v = Number(vNode.textContent);
          if (v == null || (typeof v === "string" && !v.trim())) continue;
          const xf = xfOf(+(c.getAttribute("s") || 0));
          let text, num = false, neg = false;
          if (typeof v === "object") { const d = new Date(v.iso); text = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; }
          else if (typeof v === "number") {
            if (!isFinite(v)) continue;
            if (isDateFormat(xf.fmt)) text = serialToText(v, date1904);
            else { num = true; [text, neg] = fmtNum(v, xf.fmt || "General"); }
          } else text = String(v).trim();
          const cell = { c: col, t: text };
          if (num) cell.n = 1;
          if (neg) cell.neg = 1;
          if (xf.bold) cell.b = 1;
          if (xf.kind) cell.k = xf.kind;
          cells.push(cell);
          used.add(col);
        }
        byRow.set(rn, cells);
      }
      if (!used.size) continue;
      let grid = [];
      for (let r = 1; r <= maxRow; r++) grid.push(byRow.get(r) || []);
      while (grid.length && !grid[grid.length - 1].length) grid.pop();
      while (grid.length && !grid[0].length) grid.shift();

      const first = Math.min(...used), last = Math.max(...used);
      const widthAt = {};
      all(ws, "col").forEach((c) => { const w = Number(c.getAttribute("width")); if (w) widthAt[+c.getAttribute("min")] = Math.round(w * 10) / 10; });
      const widths = [];
      for (let col = first; col <= last; col++) widths.push(widthAt[col] || 9);
      grid = grid.map((cells) => cells.map((cell) => ({ ...cell, c: cell.c - first })));
      sheets.push({ name, slug: slug(name), cols: last - first + 1, widths, rows: grid });
    }
    if (!sheets.length) throw new Error("No visible sheets with data were found in this workbook.");
    return { source: String(filename || "workbook.xlsx").split(/[\\/]/).pop(), generated: new Date().toISOString(), sheets };
  }

  const api = { extract };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BSWorkbook = api;
})(typeof window !== "undefined" ? window : globalThis);
