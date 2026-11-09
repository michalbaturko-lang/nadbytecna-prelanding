import { mailEnabled, storyTemplateId, helpTemplateId } from "./phase1-mail.mjs";
import { resendPayload } from "../emails/resend.mjs";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function service() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  return { url, key };
}

export async function serviceFetch(path, init) {
  const { url, key } = service();
  return fetch(url + path, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
}

const COLS = {
  stories: "id,email,full_name,anonymous,wants_to_help,input_type,consent,created_at,mail_sent_at",
  help_offers: "id,email,full_name,helper_type,help_kinds,consent,created_at,mail_sent_at",
};

// Odešle potvrzovací e-mail jednou (mail_sent_at + Idempotency-Key proti dvojímu odeslání).
export async function sendConfirmation(table, id, maxAgeMs) {
  if (!mailEnabled()) return { sent: false, reason: "disabled" };
  if (!COLS[table] || !UUID.test(id)) return { sent: false, reason: "id" };
  const got = await serviceFetch(`/rest/v1/${table}?id=eq.${id}&select=${COLS[table]}`, { method: "GET" });
  if (!got.ok) return { sent: false, reason: "read" };
  const rows = await got.json();
  const row = rows && rows[0];
  if (!row || row.consent !== true || row.mail_sent_at) return { sent: false, reason: "skip" };
  if (Date.now() - new Date(row.created_at).getTime() > maxAgeMs) return { sent: false, reason: "old" };
  const template = table === "stories" ? storyTemplateId(row) : helpTemplateId(row);
  const payload = resendPayload(template, { to: row.email, jmeno: row.anonymous ? "" : row.full_name || "" });
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `confirm-${table}-${id}`,
    },
    body: JSON.stringify({ from: payload.from, to: payload.to, reply_to: payload.reply_to, subject: payload.subject, html: payload.html, text: payload.text }),
  });
  if (!sent.ok) return { sent: false, reason: "send" };
  await serviceFetch(`/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ mail_sent_at: new Date().toISOString() }),
  });
  return { sent: true };
}

// Řádky, kterým potvrzení neodešlo (zavřená stránka, výpadek): starší než minAge, mladší než maxAge.
export async function pendingConfirmations(minAgeMs, maxAgeMs, limit = 20) {
  const out = [];
  const from = new Date(Date.now() - maxAgeMs).toISOString();
  const to = new Date(Date.now() - minAgeMs).toISOString();
  for (const table of Object.keys(COLS)) {
    const q = `/rest/v1/${table}?select=id&mail_sent_at=is.null&consent=eq.true&erasure_requested_at=is.null`
      + `&created_at=gte.${encodeURIComponent(from)}&created_at=lte.${encodeURIComponent(to)}&order=created_at.asc&limit=${limit}`;
    const r = await serviceFetch(q, { method: "GET" });
    if (!r.ok) continue;
    for (const row of await r.json()) out.push({ table, id: row.id });
  }
  return out.slice(0, limit);
}
