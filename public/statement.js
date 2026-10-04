// Reads the account summary from a Schwab monthly statement PDF.
// Text is pulled from the PDF in the browser (pdf.js), rebuilt into lines, then matched against
// Schwab's labels. Nothing is guessed: a figure is returned only when its label is found, and the
// matching line is kept so the person confirming can see exactly where each number came from.
(function (root) {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const mon = (s) => MONTHS[String(s).toLowerCase().slice(0, 4).replace(/[^a-z]/g, "")] || MONTHS[String(s).toLowerCase().slice(0, 3)];
  const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

  // "$1,234.56", "1,234.56", "(1,234.56)", "-$1,234.56" -> number. Requires cents so page numbers and years don't match.
  const MONEY = /\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?|\(?-?\$?\s?\d+\.\d{2}\)?/g;
  function moneyOf(s) {
    const m = String(s).match(MONEY);
    if (!m) return null;
    return m.map((t) => { const neg = /^\(|-/.test(t.trim()); const n = Number(t.replace(/[^\d.]/g, "")); return neg && n ? -n : n; });
  }

  // Statement period, in the forms Schwab uses.
  function findPeriod(lines) {
    const pats = [
      // March 1-31, 2026   |   February 1 - 28, 2026
      { re: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}),?\s*(\d{4})\b/, get: (m) => [mon(m[1]), +m[2], mon(m[1]), +m[3], +m[4], +m[4]] },
      // March 1, 2026 - March 31, 2026  |  ... to / through ...
      { re: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})\s*(?:[-–—]|to|through|thru)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})\b/i, get: (m) => [mon(m[1]), +m[2], mon(m[4]), +m[5], +m[3], +m[6]] },
      // 03/01/2026 - 03/31/2026  or 03/01/26 - 03/31/26
      { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:[-–—]|to|through|thru)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i, get: (m) => [+m[1], +m[2], +m[4], +m[5], yr(m[3]), yr(m[6])] },
    ];
    const tryLine = (line) => {
      for (const p of pats) {
        const m = line.match(p.re);
        if (!m) continue;
        const [m1, d1, m2, d2, y1, y2] = p.get(m);
        if (m1 && m2 && validDate(y1, m1, d1) && validDate(y2, m2, d2)) return { start: iso(y1, m1, d1), end: iso(y2, m2, d2), line: line.trim() };
      }
      return null;
    };
    // Prefer text next to a "Statement Period" label; otherwise the first period-shaped text on the page.
    for (let i = 0; i < lines.length; i++) {
      if (/statement\s+period|period\s+covered|reporting\s+period/i.test(lines[i])) {
        for (let k = i; k < Math.min(i + 3, lines.length); k++) { const r = tryLine(lines[k]); if (r) return r; }
      }
    }
    for (const l of lines.slice(0, 80)) { const r = tryLine(l); if (r) return r; }
    // "Account Value as of 03/31/2026"
    for (const l of lines) {
      const m = l.match(/as\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i) || null;
      if (m && validDate(yr(m[3]), +m[1], +m[2])) return { start: null, end: iso(yr(m[3]), +m[1], +m[2]), line: l.trim() };
      const n = l.match(/as\s+of\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/i);
      if (n && mon(n[1]) && validDate(+n[3], mon(n[1]), +n[2])) return { start: null, end: iso(+n[3], mon(n[1]), +n[2]), line: l.trim() };
    }
    return null;
  }
  function yr(s) { const n = +s; return n < 100 ? 2000 + n : n; }

  // First amount on the labeled line (the "This Period" column), else on the next line.
  function findAmount(lines, labels) {
    for (const re of labels) {
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const after = lines[i].slice(lines[i].search(re));
        const here = moneyOf(after.replace(re, " "));
        if (here && here.length) return { value: here[0], line: lines[i].trim() };
        const next = lines[i + 1] && moneyOf(lines[i + 1]);
        if (next && next.length) return { value: next[0], line: `${lines[i].trim()} ${lines[i + 1].trim()}` };
      }
    }
    return null;
  }

  function parseStatement(lines) {
    lines = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const out = { schwab: lines.some((l) => /schwab/i.test(l)), period: findPeriod(lines) };
    out.ending = findAmount(lines, [/ending\s+account\s+value/i, /ending\s+value/i, /total\s+account\s+value/i, /account\s+value\s+as\s+of/i, /ending\s+balance/i]);
    out.beginning = findAmount(lines, [/beginning\s+account\s+value/i, /beginning\s+value/i, /starting\s+value/i, /beginning\s+balance/i]);
    out.deposits = findAmount(lines, [/^deposits\b/i, /\bdeposits\b/i]);
    out.withdrawals = findAmount(lines, [/^withdrawals\b/i, /\bwithdrawals\b/i]);
    out.income = findAmount(lines, [/dividends\s+and\s+interest/i, /^income\b/i]);
    // Masked account number, e.g. "XXXX-1965" or "****1965".
    out.account = (lines.join(" ").match(/(?:[X*•]{2,})[-\s]?(\d{3,4})\b/i) || [])[1] || null;
    return out;
  }

  // Rebuild reading-order lines from pdf.js text items.
  function linesFromItems(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "));
  }

  const api = { parseStatement, linesFromItems, moneyOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BSStatement = api;
})(typeof window !== "undefined" ? window : globalThis);
