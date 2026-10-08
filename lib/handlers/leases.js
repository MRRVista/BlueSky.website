import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson } from "../store.js";
import { readDocs, newId } from "../docs.js";
import { readBytes } from "../ai/blob.js";
import { cleanLease } from "./properties.js";
import { USES } from "../acctypes.js";

// Lease PDFs read by Claude. The browser uploads each PDF to Documents (Property & leases), queues it here,
// then asks for one extraction per request so a large batch never hits the function time limit.
// GET                         -> { pending }
// POST { op: "queue", docIds: [], propertyId? }  | { op: "extract", id } | { op: "approve", id, propertyId, lease, leaseId? } | { op: "discard", id }
const PENDING = "data/leases/pending.json";
const PROPS_PATH = "data/properties.json";
const API = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages";
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

const DATE = { type: "string", description: "YYYY-MM-DD, or empty if not stated" };
const TOOL = {
  name: "record_lease",
  description: "Record what this lease document says. Use null or empty for anything the document doesn't state. Never guess.",
  input_schema: {
    type: "object",
    properties: {
      document_kind: { type: "string", enum: ["lease", "amendment", "other"], description: "lease = original lease; amendment = amendment, extension, renewal or assignment of an existing lease" },
      property_address: { type: "string" },
      tenant: { type: "string" }, guarantor: { type: "string" }, suite: { type: "string" },
      leased_sf: { type: "number", description: "rentable square feet leased" },
      use_type: { type: "string", enum: USES, description: "closest category for the space's use" },
      permitted_use: { type: "string" },
      commencement: DATE, expiration: DATE, rent_start: DATE,
      rent_schedule: { type: "array", description: "every base-rent period in the document", items: { type: "object", properties: { start: DATE, end: DATE, monthly_rent: { type: "number" }, annual_rent_psf: { type: "number" } } } },
      escalation: { type: "object", properties: { type: { type: "string", enum: ["fixed_pct", "fixed_amount", "cpi", "none", "other"] }, pct: { type: "number" }, note: { type: "string" } } },
      free_rent: { type: "array", items: { type: "object", properties: { start: DATE, end: DATE, note: { type: "string" } } } },
      lease_type: { type: "string", enum: ["gross", "modified_gross", "nnn", "other"] },
      reimbursements: { type: "array", items: { type: "string" }, description: "what the tenant reimburses, e.g. CAM, real estate taxes, insurance, utilities" },
      renewal_options: { type: "array", items: { type: "object", properties: { term: { type: "string" }, notice_deadline: DATE, notice_text: { type: "string", description: "how much notice and how" }, rent_basis: { type: "string" } } } },
      termination_rights: { type: "string" }, expansion_rights: { type: "string" },
      security_deposit: { type: "number" }, exclusives: { type: "string" },
      amends: { type: "object", description: "for an amendment: which lease it changes", properties: { original_date: DATE, summary: { type: "string" } } },
      changes_summary: { type: "string", description: "for an amendment: what it changes, in one or two sentences" },
      pages: { type: "object", description: "page number where each recorded field is found, keyed by the field name above", additionalProperties: { type: "number" } },
      notes: { type: "string", description: "anything unusual worth flagging (e.g. unsigned copy, missing exhibit, conflicting figures)" },
    },
    required: ["document_kind"],
  },
};

const tokens = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !["street", "suite", "ste", "the", "unit", "road", "ave", "avenue", "illinois"].includes(t));
function matchProperty(props, address) {
  const at = new Set(tokens(address));
  let best = null, score = 0;
  for (const id of props.order || Object.keys(props.properties)) {
    const p = props.properties[id];
    if (!p || p.status === "archived") continue;
    const pt = tokens(`${p.name} ${(p.building && p.building.address) || ""}`);
    const num = pt.filter((t) => /^\d+$/.test(t));
    const hit = pt.filter((t) => at.has(t)).length + (num.length && num.every((t) => at.has(t)) ? 2 : 0);
    if (hit > score) { score = hit; best = id; }
  }
  return score >= 3 ? best : null; // the street number plus the street name
}
const toLease = (x) => cleanLease({
  tenant: x.tenant, guarantor: x.guarantor, suite: x.suite, sf: x.leased_sf, useType: x.use_type, permittedUse: x.permitted_use,
  commencement: x.commencement, expiration: x.expiration, rentStart: x.rent_start,
  rentSchedule: (x.rent_schedule || []).map((r) => ({ start: r.start, end: r.end, monthly: r.monthly_rent, annualPsf: r.annual_rent_psf })),
  escalation: x.escalation, freeRent: x.free_rent, leaseType: x.lease_type, reimbursements: x.reimbursements,
  renewalOptions: (x.renewal_options || []).map((r) => ({ term: r.term, noticeBy: r.notice_deadline, notice: r.notice_text, rentBasis: r.rent_basis })),
  termination: x.termination_rights, expansion: x.expansion_rights, securityDeposit: x.security_deposit, exclusives: x.exclusives, pages: x.pages, notes: x.notes,
});
const sameTenant = (a, b) => { const A = new Set(tokens(a)), B = tokens(b); return B.length && B.filter((t) => A.has(t)).length >= Math.min(2, B.length); };

async function readLease(doc) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Reading leases needs the ANTHROPIC_API_KEY on this site's Vercel project.");
  if (!/pdf/i.test(doc.contentType || "") && !/\.pdf$/i.test(doc.filename || "")) throw new Error("Only PDF leases can be read.");
  const MAX = 22 * 1024 * 1024; // base64 adds a third; keeps the request under the API's limit
  if (doc.size > MAX) throw new Error("That PDF is over 22 MB, too large to read in one piece. Split it (or save a smaller scan) and upload again.");
  const { bytes } = await readBytes(doc.pathname);
  if (bytes.length > MAX) throw new Error("That PDF is over 22 MB, too large to read in one piece. Split it (or save a smaller scan) and upload again.");
  const body = {
    model: MODEL(), max_tokens: 6000,
    system: "You read commercial real estate leases for the owners of Blue Sky Investment Group. Record only what the document states, with the page each figure is on. Dates as YYYY-MM-DD. Monthly rent in dollars. If the document is scanned, read the page images carefully.",
    tools: [TOOL], tool_choice: { type: "tool", name: "record_lease" },
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") }, title: String(doc.filename || "lease.pdf").slice(0, 200) },
      { type: "text", text: "Record this lease (or amendment) with the record_lease tool." },
    ] }],
  };
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `The AI service answered ${r.status}.`);
  const use = (j.content || []).find((c) => c.type === "tool_use");
  if (!use) throw new Error("The lease couldn't be read.");
  return use.input;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  const store = (await readJson(PENDING, null)) || { items: [] };
  if (req.method === "GET") return res.status(200).json({ pending: store.items, configured: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
  const b = await readBody(req);
  const who = session.email, at = new Date().toISOString();
  try {
    if (b.op === "queue") {
      const docs = (await readDocs()).docs;
      const ids = (Array.isArray(b.docIds) ? b.docIds : []).slice(0, 100);
      for (const id of ids) {
        const d = docs.find((x) => x.id === id);
        if (!d) continue;
        store.items.push({ id: newId(), docId: d.id, filename: d.filename, propertyId: b.propertyId || null, status: "queued", queuedBy: who, queuedAt: at });
      }
    } else if (b.op === "extract") {
      const it = store.items.find((x) => x.id === b.id);
      if (!it) throw new Error("That lease isn't in the queue.");
      const d = (await readDocs()).docs.find((x) => x.id === it.docId);
      if (!d) throw new Error("The PDF is no longer in Documents.");
      it.status = "reading"; it.error = null;
      const patch = {};
      try {
        const raw = await readLease(d);
        const props = await readJson(PROPS_PATH, null);
        patch.result = { kind: raw.document_kind, address: raw.property_address || null, lease: toLease(raw), amends: raw.amends || null, changes: raw.changes_summary || null };
        if (!it.propertyId && props) patch.suggestedProperty = matchProperty(props, raw.property_address);
        const pid = it.propertyId || patch.suggestedProperty;
        // An amendment: find the lease it changes.
        if (props && pid && props.properties[pid] && raw.document_kind === "amendment") {
          const m = (props.properties[pid].leases || []).find((l) => sameTenant(l.tenant, raw.tenant));
          patch.amendsLeaseId = m ? m.id : null;
        }
        patch.status = raw.document_kind === "other" ? "not-a-lease" : "ready";
        patch.readAt = new Date().toISOString();
      } catch (e) { patch.status = "error"; patch.error = e.message; }
      // The read can take a minute: apply the result to the queue as it is now (other PDFs may have been added).
      const fresh = (await readJson(PENDING, null)) || { items: [] };
      const cur = fresh.items.find((x) => x.id === b.id);
      if (cur) Object.assign(cur, patch);
      store.items = fresh.items;
    } else if (b.op === "approve") {
      const it = store.items.find((x) => x.id === b.id);
      if (!it || !it.result) throw new Error("That lease hasn't been read yet.");
      const props = await readJson(PROPS_PATH, null);
      const pid = b.propertyId || it.propertyId || it.suggestedProperty;
      const p = props && props.properties[pid];
      if (!p || p.status !== "active") throw new Error("Pick the property this lease belongs to.");
      p.leases = p.leases || []; p.tenants = p.tenants || [];
      const L = cleanLease({ ...it.result.lease, ...(b.lease || {}) });
      const target = b.leaseId ? p.leases.find((l) => l.id === b.leaseId) : it.result.kind === "amendment" && it.amendsLeaseId ? p.leases.find((l) => l.id === it.amendsLeaseId) : null;
      let lease;
      if (target) {
        // Apply the amendment: whatever it states replaces the old term; the rest carries over.
        for (const [k, v] of Object.entries(L)) {
          if (v == null || (Array.isArray(v) && !v.length) || (k === "pages" && !Object.keys(v).length)) continue;
          if (k === "rentSchedule") {
            // New periods replace the old schedule from their first date on; earlier periods stay.
            const first = v.map((r) => r.start).filter(Boolean).sort()[0];
            const keep = (target.rentSchedule || []).filter((r) => !first || !r.start || r.start < first).map((r) => (first && r.end && r.end >= first ? { ...r, end: new Date(Date.parse(first) - 864e5).toISOString().slice(0, 10) } : r));
            target.rentSchedule = keep.concat(v).sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1));
          } else if (k === "pages") target.pages = { ...(target.pages || {}), ...v };
          else target[k] = v;
        }
        target.amendments = (target.amendments || []).concat([{ docId: it.docId, filename: it.filename, summary: it.result.changes || (it.result.amends && it.result.amends.summary) || "Amendment", addedBy: who, addedAt: at }]);
        target.updatedBy = who; target.updatedAt = at;
        lease = target;
      } else {
        lease = { id: newId(), ...L, docIds: [it.docId], filename: it.filename, kind: it.result.kind, confirmedBy: who, confirmedAt: at, amendments: [] };
        p.leases.push(lease);
      }
      // Tie the lease to its tenant (detected from deposits, or new).
      let tn = p.tenants.find((t) => t.leaseId === lease.id) || p.tenants.find((t) => t.status !== "rejected" && sameTenant(t.name, lease.tenant));
      const current = (lease.rentSchedule || []).find((r) => (!r.start || r.start <= at.slice(0, 10)) && (!r.end || r.end >= at.slice(0, 10)));
      if (!tn && lease.tenant) { tn = { id: newId(), name: lease.tenant, keys: [], status: "active", source: "lease", alertDay: 10, createdAt: at }; p.tenants.push(tn); }
      if (tn) { tn.leaseId = lease.id; if (tn.status === "suggested") tn.status = "active"; if (current && current.monthly) tn.expected = current.monthly; if (lease.suite) tn.suite = lease.suite; lease.tenantId = tn.id; }
      p.log = [{ at, by: who, change: `${target ? "Amendment applied to" : "Lease added for"} ${lease.tenant || "a tenant"} (${it.filename})` }].concat(p.log || []).slice(0, 300);
      props.version = (props.version || 0) + 1; props.updatedAt = at; props.updatedBy = who;
      await writeJson(PROPS_PATH, props);
      store.items = store.items.filter((x) => x.id !== b.id);
      await writeJson(PENDING, store);
      return res.status(200).json({ pending: store.items, properties: props, leaseId: lease.id, propertyId: pid });
    } else if (b.op === "discard") {
      store.items = store.items.filter((x) => x.id !== b.id);
    } else if (b.op === "setProperty") {
      const it = store.items.find((x) => x.id === b.id);
      if (it) it.propertyId = b.propertyId || null;
    } else throw new Error("Unknown action.");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await writeJson(PENDING, store);
  return res.status(200).json({ pending: store.items });
}
