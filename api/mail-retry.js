import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { mailEnabled } from "../lib/phase1-mail.mjs";
import { pendingConfirmations, sendConfirmation } from "../lib/confirm-mail.mjs";

// Cron: doposílá potvrzovací e-maily, které se z prohlížeče neodeslaly (zavřená stránka, výpadek).
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method" });
  const expected = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (expected.length < 24 || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
    return json(res, 401, { error: "auth" });
  if (!mailEnabled()) return json(res, 200, { skipped: true });
  try {
    const day = 24 * 3600e3;
    const rows = await pendingConfirmations(3 * 60e3, day);
    let sent = 0;
    for (const r of rows) if ((await sendConfirmation(r.table, r.id, day)).sent) sent += 1;
    return json(res, 200, { pending: rows.length, sent });
  } catch {
    return json(res, 503, { error: "retry_failed" });
  }
}
