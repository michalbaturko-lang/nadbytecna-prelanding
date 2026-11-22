import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { supa, restPath, exact, assertAudioPath } from "../lib/admin-server.mjs";
import { buildCopy } from "../lib/forward-copy.mjs";

// Každých 5 minut pošle nové příběhy a nabídky (celý text + kontakt) na FORWARD_COPY_TO.
// Bez FORWARD_COPY_TO, RESEND_API_KEY a MAIL_FROM se nic neodesílá. Značka: forwarded_at.
const TABLES = {
  stories: "id,created_at,full_name,email,anonymous,wants_to_help,consent_publish,input_type,story_text,audio_path",
  help_offers: "id,created_at,full_name,email,phone,helper_type,help_kinds,links,message,consent_publish",
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method" });
  const expected = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (expected.length < 24 || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
    return json(res, 401, { error: "auth" });
  const to = String(process.env.FORWARD_COPY_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  const from = process.env.FORWARD_COPY_FROM || process.env.MAIL_FROM;
  if (!to.length || !process.env.RESEND_API_KEY || !from) return json(res, 200, { skipped: true });
  let sent = 0, failed = 0;
  for (const table of Object.keys(TABLES)) {
    const rows = await supa(
      restPath(table, {
        select: TABLES[table],
        forwarded_at: "is.null",
        consent: "eq.true",
        erasure_requested_at: "is.null",
        email: "not.ilike.*@resend.dev",
        order: "created_at.asc",
        limit: "20",
      }),
    );
    for (const row of rows) {
      try {
        let audioUrl = "";
        if (table === "stories" && row.audio_path) {
          assertAudioPath(row.audio_path, row.id);
          const s = await supa("/storage/v1/object/sign/story-audio/" + row.audio_path.split("/").map(encodeURIComponent).join("/"), {
            method: "POST",
            body: { expiresIn: 7 * 86400 },
          });
          const base = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
          audioUrl = base + "/storage/v1" + s.signedURL;
        }
        const m = buildCopy(table, row, audioUrl);
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, reply_to: row.email || undefined, subject: m.subject, html: m.html, text: m.text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error("resend");
        await supa(restPath(table, { id: exact(row.id) }), { method: "PATCH", body: { forwarded_at: new Date().toISOString() }, prefer: "return=minimal" });
        sent++;
      } catch {
        failed++;
      }
    }
  }
  return json(res, 200, { sent, failed });
}
