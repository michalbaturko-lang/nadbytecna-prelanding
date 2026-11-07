import { json } from "../lib/http.js";
import { triageEnabled, triageText } from "../lib/triage.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cfg() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "");
  return { url, key };
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function userOf(token, c) {
  const res = await fetch(c.url + "/auth/v1/user", { headers: { apikey: c.key, Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  return res.json();
}

async function isAdmin(token, c, user) {
  const byId = await fetch(c.url + "/rest/v1/admins?select=user_id&user_id=eq." + user.id, {
    headers: { apikey: c.key, Authorization: "Bearer " + token },
  });
  if (byId.ok) {
    const rows = await byId.json();
    if (Array.isArray(rows) && rows.length) return true;
  }
  const email = String(user.email || "").toLowerCase();
  if (!email) return false;
  const byMail = await fetch(c.url + "/rest/v1/admin_emails?select=email&email=eq." + encodeURIComponent(email), {
    headers: { apikey: c.key, Authorization: "Bearer " + token },
  });
  if (!byMail.ok) return false;
  const rows = await byMail.json();
  return Array.isArray(rows) && rows.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: "json" }); }
  const table = body.table === "help_offers" ? "help_offers" : body.table === "stories" ? "stories" : "";
  const id = String(body.id || "");
  const manual = Boolean(body.manual);
  if (!table || !UUID.test(id)) return json(res, 400, { error: "id" });
  if (!manual && !triageEnabled()) return json(res, 200, { skipped: true });
  const c = cfg();
  if (!c.url || !c.key) return json(res, 200, { skipped: true });
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(res, 401, { error: "auth" });
  const user = await userOf(token, c);
  if (!user) return json(res, 401, { error: "auth" });
  if (!(await isAdmin(token, c, user))) return json(res, 403, { error: "admin" });
  const cols = table === "stories" ? "story_text,transcript" : "message,help_kinds";
  const rowRes = await fetch(c.url + "/rest/v1/" + table + "?id=eq." + id + "&select=" + cols, {
    headers: { apikey: c.key, Authorization: "Bearer " + token },
  });
  if (!rowRes.ok) return json(res, 403, { error: "read" });
  const rows = await rowRes.json();
  const row = rows && rows[0];
  if (!row) return json(res, 404, { error: "missing" });
  const text = table === "stories" ? (row.story_text || row.transcript || "") : (row.message || "");
  try {
    const out = await triageText({ kind: table === "stories" ? "story" : "help", text, key: process.env.OPENAI_API_KEY });
    const patch = {
      ai_summary: out.summary,
      ai_category: out.category,
      ai_urgency: out.urgency,
      ai_help_type: out.help_type,
      ai_model: out.model,
      ai_at: new Date().toISOString(),
    };
    if (table === "help_offers") patch.ai_matches = (out.matches || []).join("\n");
    const saved = await fetch(c.url + "/rest/v1/" + table + "?id=eq." + id, {
      method: "PATCH",
      headers: { apikey: c.key, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!saved.ok) return json(res, 200, { ok: false, saved: false });
    return json(res, 200, { ok: true, category: out.category, urgency: out.urgency, help_type: out.help_type, summary: out.summary, model: out.model });
  } catch (e) {
    if (e && e.code === "no-key") return json(res, 200, { skipped: true });
    if (e && e.code === "openai-auth") return json(res, 502, { error: "openai-auth" });
    return json(res, 200, { ok: false, error: "openai" });
  }
}
