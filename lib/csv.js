// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes/newlines).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function money(v) {
  if (v == null) return 0;
  const t = String(v).replace(/[$,\s%]/g, "");
  if (!t || t === "--" || t === "-" || t === "N/A") return 0;
  const n = Number(t.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : 0;
}

// "09/22/2026" or "04/27/2026 as of 04/24/2026" -> "2026-09-22"
export function isoDate(v) {
  const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
