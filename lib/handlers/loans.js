import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { getFedFunds } from "../fedfunds.js";
import { computeAll } from "../loans.js";
import { newId } from "../docs.js";

const PATH = "data/loans.json";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const FIELDS = ["name", "lender", "kind", "rateType", "fixedRate", "spread", "originalPrincipal", "amortMonths", "firstPaymentDate", "maturityDate", "openedDate", "escrowMonthly", "paymentOverride", "autoBalance", "notes"];
const NUMERIC = new Set(["fixedRate", "spread", "originalPrincipal", "amortMonths", "escrowMonthly", "paymentOverride"]);

function clean(input) {
  const o = {};
  for (const k of FIELDS) {
    if (!(k in input)) continue;
    let v = input[k];
    if (NUMERIC.has(k)) v = num(v);
    else if (k === "autoBalance") v = !!v;
    else v = v == null ? null : String(v).slice(0, k === "notes" ? 4000 : 200).trim() || null;
    o[k] = v;
  }
  if (o.kind && !["amortizing", "margin", "interest-only", "line"].includes(o.kind)) o.kind = "interest-only";
  if (o.rateType && !["fixed", "floating"].includes(o.rateType)) o.rateType = "fixed";
  return o;
}

async function state(force) {
  const store = (await readJson(PATH, null)) || { loans: [], fedOverride: null };
  const feed = await getFedFunds({ force });
  const fed = store.fedOverride ? { ...feed, upper: store.fedOverride.upper, lower: store.fedOverride.lower, overridden: true } : feed;
  const p = await readJson(PORTFOLIO_PATH, null);
  const marginBalance = p && p.positions ? { value: p.positions.margin, asOf: p.positions.asOf } : null;
  const calc = computeAll(store.loans, { today: today(), fed, marginBalance });
  return { store, feed, fed, marginBalance, today: today(), ...calc };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });

  if (req.method === "GET") {
    const s = await state(req.query.refresh === "1");
    return res.status(200).json({ loans: s.store.loans, fedOverride: s.store.fedOverride, feed: s.feed, fed: s.fed, marginBalance: s.marginBalance, today: s.today, rows: s.rows.map((r) => r.calc), totals: s.totals, scenarios: s.scenarios });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });

  const body = await readBody(req);
  const store = (await readJson(PATH, null)) || { loans: [], fedOverride: null };
  const who = session.email, at = new Date().toISOString();
  const find = () => store.loans.find((l) => l.id === body.id);
  const log = (l, change) => { l.history = (l.history || []).concat([{ at, by: who, change }]).slice(-100); l.updatedAt = at; l.updatedBy = who; };

  switch (body.op) {
    case "add": {
      const l = { id: newId(), status: "open", kind: "amortizing", rateType: "fixed", ...clean(body.loan || {}), createdAt: at, createdBy: who };
      if (!l.name) return res.status(400).json({ error: "Give the loan a name." });
      log(l, "Loan added");
      store.loans.push(l);
      break;
    }
    case "update": {
      const l = find(); if (!l) return res.status(404).json({ error: "Loan not found." });
      const c = clean(body.loan || {});
      const changed = Object.keys(c).filter((k) => String(c[k] ?? "") !== String(l[k] ?? ""));
      Object.assign(l, c);
      log(l, changed.length ? `Edited: ${changed.join(", ")}` : "Saved with no changes");
      break;
    }
    case "balance": {
      const l = find(); if (!l) return res.status(404).json({ error: "Loan not found." });
      const v = num(body.value);
      if (v == null) { delete l.balanceOverride; log(l, "Entered balance cleared; using schedule"); }
      else { l.balanceOverride = { value: v, asOf: String(body.asOf || today()).slice(0, 10) }; log(l, `Balance set to ${v.toFixed(2)} as of ${l.balanceOverride.asOf}`); }
      break;
    }
    case "close": {
      const l = find(); if (!l) return res.status(404).json({ error: "Loan not found." });
      l.status = "closed"; l.closedDate = String(body.date || today()).slice(0, 10); l.closeNote = String(body.note || "").slice(0, 500);
      log(l, `Closed ${l.closedDate}${l.closeNote ? ": " + l.closeNote : ""}`);
      break;
    }
    case "reopen": {
      const l = find(); if (!l) return res.status(404).json({ error: "Loan not found." });
      l.status = "open"; delete l.closedDate; log(l, "Reopened");
      break;
    }
    case "delete": {
      const before = store.loans.length;
      store.loans = store.loans.filter((l) => l.id !== body.id);
      if (store.loans.length === before) return res.status(404).json({ error: "Loan not found." });
      break;
    }
    case "fedOverride": {
      const upper = num(body.upper);
      store.fedOverride = upper == null ? null : { upper, lower: num(body.lower) ?? upper - 0.25, setBy: who, setAt: at };
      break;
    }
    case "refreshFed":
      await getFedFunds({ force: true });
      break;
    default:
      return res.status(400).json({ error: "Unknown action." });
  }
  try { await writeJson(PATH, store); }
  catch (err) { console.error("loans save failed", err); return res.status(500).json({ error: "Couldn't save. Try again." }); }
  const s = await state(false);
  return res.status(200).json({ ok: true, loans: s.store.loans, fedOverride: s.store.fedOverride, feed: s.feed, fed: s.fed, marginBalance: s.marginBalance, today: s.today, rows: s.rows.map((r) => r.calc), totals: s.totals, scenarios: s.scenarios });
}
