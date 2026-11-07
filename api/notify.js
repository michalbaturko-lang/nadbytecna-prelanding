import { json } from "../lib/http.js";
import { mailEnabled, storyTemplateId, helpTemplateId } from "../lib/phase1-mail.mjs";
import { resendPayload } from "../emails/resend.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase(); }
  catch { return false; }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2000) throw Object.assign(new Error("size"), { code: "size" });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function service() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  return { url, key };
}

async function serviceFetch(path, init) {
  const { url, key } = service();
  return fetch(url + path, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
  if (!mailEnabled()) return json(res, 200, { sent: false });
  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: "json" }); }
  const table = body && body.table === "help_offers" ? "help_offers" : body && body.table === "stories" ? "stories" : "";
  const id = String(body && body.id || "");
  if (!table || !UUID.test(id)) return json(res, 400, { error: "id" });
  const cols = table === "stories"
    ? "id,email,full_name,anonymous,wants_to_help,input_type,consent,created_at,mail_sent_at"
    : "id,email,full_name,helper_type,help_kinds,consent,created_at,mail_sent_at";
  const got = await serviceFetch(`/rest/v1/${table}?id=eq.${id}&select=${cols}`, { method: "GET" });
  if (!got.ok) return json(res, 200, { sent: false });
  const rows = await got.json();
  const row = rows && rows[0];
  if (!row || row.consent !== true || row.mail_sent_at) return json(res, 200, { sent: false });
  if (Date.now() - new Date(row.created_at).getTime() > 30 * 60e3) return json(res, 200, { sent: false });
  const template = table === "stories" ? storyTemplateId(row) : helpTemplateId(row);
  const payload = resendPayload(template, { to: row.email, jmeno: row.anonymous ? "" : row.full_name || "" });
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: payload.from, to: payload.to, reply_to: payload.reply_to, subject: payload.subject, html: payload.html, text: payload.text }),
  });
  if (!sent.ok) return json(res, 200, { sent: false });
  await serviceFetch(`/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ mail_sent_at: new Date().toISOString() }),
  });
  return json(res, 200, { sent: true });
}
