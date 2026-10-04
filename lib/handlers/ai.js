// AI Assistant: chat with Claude about the account, properties and loans, read attached files,
// and make any change a person can make in the app. Read tools run on their own; every change
// waits for the user to approve it. Each request runs one model turn so long tasks never hit
// the function time limit; the browser asks for the next turn until the answer is done.
import crypto from "node:crypto";
import { getSession, readJson as readBody, sameOrigin } from "../auth.js";
import { readJson, writeJson, PORTFOLIO_PATH } from "../store.js";
import { newId, safeName } from "../docs.js";
import { signUpload, readBytes, MAX_UPLOAD } from "../ai/blob.js";
import { TOOLS, WRITE_TOOLS, TOOL_LABELS, runTool, changeDetails, documentBlocks } from "../ai/tools.js";

const API = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages";
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const userKey = (email) => crypto.createHash("sha256").update(email).digest("hex").slice(0, 24);
const convPath = (email, id) => `ai/conv/${userKey(email)}/${id}.json`;
const indexPath = (email) => `ai/index/${userKey(email)}.json`;
const NAMES = { "mrice@vistamarkllc.com": "Matt Rice", "jen@blueskyinvestmentgroup.com": "Jen Lambert" };
const MAX_STEPS = 30; // model turns per user message

const STATIC_SYSTEM = `You are the AI Assistant inside bluesky.website, the private portal of Blue Sky Investment Group. Two people use it: Matt Rice (CFA, CAIA; Vistamark Investments, the adviser) and Jen Lambert (Blue Sky Investment Group, the owner).

What the site tracks
- Schwab account ending 965, the "5100 Main Equity Strip": proceeds of the 5100 Main refinance (a $1,509,969 wire on 3/2/2026) invested in high-income ETFs and closed-end funds (covered-call funds such as QQQI, SPYI, GPIX and others), bought partly on margin. Performance inception is 3/1/2026. Returns are measured on net equity (after the margin loan), so they include leverage.
- Real estate: 5100 Main (active: building details, mortgage, rent and expense ledger) and 333 Chestnut (shown as "coming soon"; it can't be edited until it's switched on).
- Loans tab (margin loan, mortgages, lines, tied to the Fed Funds rate), Discussion Topics, Watch Items, and a Documents library.
- Tabs: Performance, Gains & Losses, Income, Tax, Properties, Discussion Topics, Watch Items, Documents, Admin, plus the original 5100 Main workbook tabs.

How to work
- Get facts from the tools. Never guess a balance, value, date or rate; if the data isn't on file, say so and say where to add it.
- To change anything, call the matching write tool. The user sees each change and approves or declines it before it's saved, so propose changes directly instead of asking "shall I?" first. If something needed is ambiguous (which property, which date, which of two loans), ask one short question instead of guessing.
- Before replacing a record (building details, mortgage terms), read it first and carry over the fields you aren't changing.
- Attached files: PDFs and images are attached directly; Excel, Word, PowerPoint and CSV files arrive as extracted text. Read them carefully, pull out the figures, and offer the updates they support (for a Schwab statement: the month-end account value; for a lease: rent entries; for a loan document: mortgage or loan terms; for a tax bill: property tax entries). Say which figures you took from where.
- Ledger amounts are positive numbers; the category decides whether it is money in (Rent) or out. Dates go to tools as YYYY-MM-DD.
- "What if" and stress questions (for example "what if the market falls 25% over 6 months"): use run_scenario, starting from the user's numbers. State the key assumptions in one line (downside capture, what happens to distributions, margin rate, Schwab's requirement), then give the result: equity before and after, margin balance, distributions and margin interest over the period, whether and when a margin call would come, and the decline that would trigger one. Offer one or two useful variations (for example covered-call funds falling 80% as much as the market, or distributions cut 20%). These are projections from today's positions, not forecasts.
- Write for a phone screen: lead with the answer, short paragraphs, bullets or a small table only when they help. Use plain words and avoid jargon; if a term is needed, define it briefly. Dollars like $1,234 (no cents unless they matter), dates like 3/31/2026.
- This is analysis for the owners and their adviser, not tax or legal advice; mention that only when a question turns on tax or legal treatment.`;

/* ---------------- storage ---------------- */
async function loadConv(email, id) {
  const c = await readJson(convPath(email, id), null);
  if (!c) throw Object.assign(new Error("That conversation wasn't found."), { code: 404 });
  return c;
}
async function saveConv(email, c) {
  c.updatedAt = new Date().toISOString();
  await writeJson(convPath(email, c.id), c);
  const idx = (await readJson(indexPath(email), null)) || { items: [] };
  idx.items = [{ id: c.id, title: c.title, updatedAt: c.updatedAt }].concat(idx.items.filter((x) => x.id !== c.id)).slice(0, 200);
  await writeJson(indexPath(email), idx);
}

/* ---------------- building the request ---------------- */
async function overview() {
  const lines = [];
  try {
    const p = await readJson(PORTFOLIO_PATH, null);
    if (p && p.positions) {
      const pos = p.positions;
      const inc = pos.holdings.reduce((a, h) => a + h.marketValue * (h.yield || 0), 0);
      lines.push(`Latest positions ${pos.asOf}: gross $${Math.round(pos.gross).toLocaleString()}, margin loan $${Math.round(pos.margin).toLocaleString()}, net $${Math.round(pos.net).toLocaleString()}, ${pos.holdings.length} holdings (${pos.holdings.map((h) => h.symbol).join(", ")}), estimated income $${Math.round(inc).toLocaleString()} a year before margin interest.`);
    }
    if (p && p.valuations && p.valuations.length) lines.push(`Statement/valuation dates on file: ${p.valuations.map((v) => v.date).join(", ")}.`);
  } catch {}
  try {
    const d = await readJson("data/properties.json", null);
    if (d) lines.push("Properties: " + (d.order || Object.keys(d.properties)).map((id) => { const x = d.properties[id]; return `${x.name} [${id}] ${x.status}${x.status === "active" ? `, ${x.entries.length} ledger entries, ${x.mortgage ? "mortgage on file" : "no mortgage entered"}` : ""}`; }).join("; ") + ".");
  } catch {}
  return lines.join("\n");
}

async function systemBlocks(session, context) {
  const now = new Date();
  const dt = now.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const dynamic = `Now: ${dt} (Central). Signed in: ${NAMES[session.email] || session.email} (${session.email}).${context && context.tab ? ` They are on the "${context.tab}" tab.` : ""}\n${await overview()}`;
  return [{ type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } }, { type: "text", text: dynamic }];
}

// Stored messages keep only references to files; expand them for the API.
async function expandBlock(b) {
  if (b.type === "bs_file") {
    if (b.kind === "text") return { type: "text", text: `[Attached file: ${b.name}]\n${b.text || ""}` };
    try { return await documentBlocks(b.path, b.mediaType, b.name); }
    catch (e) { return { type: "text", text: `[Attached file ${b.name} couldn't be read: ${e.message}]` }; }
  }
  if (b.type === "tool_result" && Array.isArray(b.content)) {
    const content = [];
    for (const c of b.content) {
      if (c.type === "bs_docref") {
        try { content.push(...(await documentBlocks(c.path, c.mediaType, c.name))); }
        catch (e) { content.push({ type: "text", text: `Couldn't reopen ${c.name}: ${e.message}` }); }
      } else content.push(c);
    }
    return { ...b, content };
  }
  return b;
}
async function apiMessages(conv) {
  const out = [];
  for (const m of conv.messages) {
    if (typeof m.content === "string") { out.push(m); continue; }
    const content = [];
    for (const b of m.content) { const x = await expandBlock(b); Array.isArray(x) ? content.push(...x) : content.push(x); }
    out.push({ role: m.role, content });
  }
  // Cache everything up to the newest message so attached files aren't re-processed every turn.
  const last = out[out.length - 1];
  if (last && Array.isArray(last.content) && last.content.length) last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: { type: "ephemeral" } };
  return out;
}

async function callClaude(session, conv, context) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("The AI Assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to this site's Vercel project (Settings → Environment Variables), then redeploy."), { code: 503 });
  const body = { model: MODEL(), max_tokens: 8000, system: await systemBlocks(session, context), tools: TOOLS, messages: await apiMessages(conv) };
  let r, attempt = 0;
  for (;;) {
    r = await fetch(API, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 2) { attempt++; await new Promise((s) => setTimeout(s, 1500 * attempt)); continue; }
    break;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data && data.error && data.error.message;
    console.error("anthropic error", r.status, msg);
    if (r.status === 401) throw Object.assign(new Error("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the Vercel project."), { code: 503 });
    if (r.status === 429 || r.status === 529) throw Object.assign(new Error("The AI service is busy right now. Try again in a minute."), { code: 503 });
    if (r.status === 400 && /too long|too large|prompt is too long/i.test(msg || "")) throw Object.assign(new Error("This conversation has grown too long (large files add up). Start a new chat and attach only what you need."), { code: 400 });
    throw Object.assign(new Error(`The AI service returned an error${msg ? `: ${msg}` : ""}.`), { code: 502 });
  }
  return data;
}

/* ---------------- one model turn ---------------- */
async function step(req, session, conv, context) {
  if (conv.pending) return conv;
  conv.steps = (conv.steps || 0) + 1;
  if (conv.steps > MAX_STEPS) {
    conv.messages.push({ role: "assistant", content: [{ type: "text", text: "I've stopped here because this took more steps than allowed in one go. Tell me to continue if you want me to keep going." }] });
    conv.status = "done";
    return conv;
  }
  const res = await callClaude(session, conv, context);
  conv.messages.push({ role: "assistant", content: res.content });
  conv.usage = { input: (conv.usage?.input || 0) + (res.usage?.input_tokens || 0), output: (conv.usage?.output || 0) + (res.usage?.output_tokens || 0) };
  if (res.stop_reason !== "tool_use") {
    if (res.stop_reason === "max_tokens") conv.messages.push({ role: "assistant", content: [{ type: "text", text: "(That answer hit the length limit. Ask me to continue.)" }] });
    conv.status = "done";
    return conv;
  }
  const uses = res.content.filter((b) => b.type === "tool_use");
  const results = {};
  const writes = [];
  for (const u of uses) {
    if (WRITE_TOOLS.has(u.name)) { writes.push({ id: u.id, name: u.name, label: TOOL_LABELS[u.name] || u.name, summary: (u.input && u.input.summary) || TOOL_LABELS[u.name], details: changeDetails(u.name, u.input) }); continue; }
    results[u.id] = await execute(req, conv, u);
  }
  if (writes.length) { conv.pending = { results, writes }; conv.status = "approval"; return conv; }
  conv.messages.push({ role: "user", content: uses.map((u) => results[u.id]) });
  conv.status = "continue";
  return conv;
}

async function execute(req, conv, u) {
  try {
    const out = await runTool(u.name, u.input || {}, { req, conv });
    if (out.changed) conv.changed = [...new Set((conv.changed || []).concat(out.changed))];
    let content = out.content;
    // Don't store document bytes in the conversation; keep a reference and reopen it when needed.
    if (u.name === "read_document" && Array.isArray(content)) {
      const { readDocs } = await import("../docs.js");
      const d = (await readDocs()).docs.find((x) => x.id === u.input.id);
      content = [{ type: "bs_docref", path: d.pathname, mediaType: d.contentType, name: d.filename }];
    }
    if (typeof content === "string" && content.length > 150000) content = content.slice(0, 150000) + "\n[truncated]";
    return { type: "tool_result", tool_use_id: u.id, content };
  } catch (e) {
    return { type: "tool_result", tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true };
  }
}

async function resolvePending(req, conv, decisions) {
  const p = conv.pending;
  if (!p) return conv;
  const last = conv.messages[conv.messages.length - 1];
  const uses = last.content.filter((b) => b.type === "tool_use");
  for (const u of uses) {
    if (p.results[u.id]) continue;
    const w = p.writes.find((x) => x.id === u.id);
    const yes = decisions === true || (decisions && decisions[u.id] === true);
    if (yes) { p.results[u.id] = await execute(req, conv, u); w.outcome = p.results[u.id].is_error ? "error" : "approved"; w.error = p.results[u.id].is_error ? String(p.results[u.id].content).replace(/^Error: /, "") : null; }
    else { p.results[u.id] = { type: "tool_result", tool_use_id: u.id, content: "The user declined this change. Nothing was saved." }; w.outcome = "declined"; }
  }
  conv.decided = (conv.decided || []).concat(p.writes);
  conv.messages.push({ role: "user", content: uses.map((u) => p.results[u.id]) });
  conv.pending = null;
  conv.status = "continue";
  return conv;
}

/* ---------------- what the browser shows ---------------- */
function display(conv) {
  const out = [];
  const status = {};
  const decided = Object.fromEntries((conv.decided || []).map((w) => [w.id, w]));
  for (const m of conv.messages) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") status[b.tool_use_id] = b.is_error ? "error" : /declined this change/.test(typeof b.content === "string" ? b.content : "") ? "declined" : "done";
  for (const m of conv.messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    if (m.role === "user") {
      if (blocks.every((b) => b.type === "tool_result")) continue;
      out.push({ role: "user", text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"), files: blocks.filter((b) => b.type === "bs_file").map((b) => b.name) });
    } else {
      for (const b of blocks) {
        if (b.type === "text" && b.text.trim()) out.push({ role: "assistant", text: b.text });
        else if (b.type === "tool_use") {
          const d = decided[b.id];
          out.push({ role: "tool", name: b.name, label: TOOL_LABELS[b.name] || b.name, write: WRITE_TOOLS.has(b.name), summary: WRITE_TOOLS.has(b.name) ? b.input && b.input.summary : scenarioLine(b), status: d ? d.outcome : status[b.id] || "pending", error: d && d.error });
        }
      }
    }
  }
  return out;
}
function scenarioLine(b) {
  const i = b.input || {};
  if (b.name === "run_scenario") return `${i.decline_pct ?? 20}% ${Number(i.decline_pct) < 0 ? "rise" : "decline"} ${i.shape === "immediate" ? "at once" : `over ${i.months ?? 6} months`}${i.recover_months ? `, recovering over ${i.recover_months}` : ""}`;
  if (b.name === "get_market_prices") return (i.symbols || []).join(", ");
  if (b.name === "get_transactions") return [i.symbol, i.action, i.from && `from ${i.from}`, i.to && `to ${i.to}`].filter(Boolean).join(" ");
  return null;
}
const reply = (conv) => ({ id: conv.id, title: conv.title, status: conv.status, display: display(conv), pending: conv.pending ? conv.pending.writes : null, changed: conv.changed || [], files: (conv.files || []).map((f) => f.name) });

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  req.session = session;
  const email = session.email;

  try {
    if (req.method === "GET") {
      if (req.query.id) { const c = await loadConv(email, String(req.query.id)); c.changed = []; return res.status(200).json(reply(c)); }
      const idx = (await readJson(indexPath(email), null)) || { items: [] };
      return res.status(200).json({ items: idx.items, configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL() });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    if (!sameOrigin(req)) return res.status(403).json({ error: "Request blocked." });
    const b = await readBody(req);

    if (b.op === "sign") {
      const size = Number(b.size) || 0;
      if (size > MAX_UPLOAD) return res.status(400).json({ error: "Attachments can be up to 30 MB." });
      const path = `ai/uploads/${userKey(email)}/${newId()}/${safeName(b.filename)}`;
      return res.status(200).json({ path, url: await signUpload(path) });
    }
    if (b.op === "delete") {
      const idx = (await readJson(indexPath(email), null)) || { items: [] };
      idx.items = idx.items.filter((x) => x.id !== b.id);
      await writeJson(indexPath(email), idx);
      return res.status(200).json({ ok: true, items: idx.items });
    }

    let conv;
    if (b.op === "send") {
      const text = String(b.text || "").slice(0, 20000).trim();
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 10);
      if (!text && !files.length) return res.status(400).json({ error: "Type a message or attach a file." });
      const myPrefix = `ai/uploads/${userKey(email)}/`;
      const refs = files.map((f) => {
        if (!String(f.path || "").startsWith(myPrefix)) throw Object.assign(new Error("An attachment didn't upload correctly. Attach it again."), { code: 400 });
        return { type: "bs_file", path: f.path, name: String(f.name || "file").slice(0, 160), mediaType: String(f.mediaType || ""), originalType: String(f.originalType || f.mediaType || ""), kind: ["pdf", "image", "text"].includes(f.kind) ? f.kind : "text", size: Number(f.size) || null, text: f.kind === "text" ? String(f.text || "").slice(0, 400000) : undefined };
      });
      conv = b.id ? await loadConv(email, String(b.id)) : { id: newId(), title: (text || refs.map((r) => r.name).join(", ")).replace(/\s+/g, " ").slice(0, 70), by: email, createdAt: new Date().toISOString(), messages: [], files: [] };
      if (conv.pending) await resolvePending(req, conv, false); // a new message declines anything left waiting
      const note = refs.length ? `\n\n(Attached: ${refs.map((r) => r.name).join(", ")})` : "";
      conv.messages.push({ role: "user", content: [...refs, { type: "text", text: (text || "Please review the attached file(s).") + note }] });
      conv.files = (conv.files || []).concat(refs.map(({ type, ...r }) => r));
      conv.steps = 0;
      conv.changed = [];
    } else if (b.op === "continue") {
      conv = await loadConv(email, String(b.id));
      conv.changed = [];
      if (conv.status !== "continue" && conv.status !== "error") return res.status(200).json(reply(conv));
    } else if (b.op === "decide") {
      conv = await loadConv(email, String(b.id));
      conv.changed = [];
      if (!conv.pending) return res.status(200).json(reply(conv));
      await resolvePending(req, conv, b.approve === true ? true : b.approve === false ? false : b.decisions || false);
      await saveConv(email, conv);
      return res.status(200).json(reply(conv)); // browser asks for the next turn
    } else return res.status(400).json({ error: "Unknown action." });

    try { await step(req, session, conv, b.context); }
    catch (e) {
      // Keep the conversation consistent: drop a dangling user turn's response attempt but keep the message.
      await saveConv(email, { ...conv, status: "error" });
      return res.status(e.code || 500).json({ error: e.message, ...reply({ ...conv, status: "error" }) });
    }
    await saveConv(email, conv);
    return res.status(200).json(reply(conv));
  } catch (e) {
    console.error("ai handler", e);
    return res.status(e.code || 500).json({ error: e.code ? e.message : "Something went wrong. Try again." });
  }
}
