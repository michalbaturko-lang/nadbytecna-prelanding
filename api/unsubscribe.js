import { db } from "../lib/db.js";
import { body, json, originOk } from "../lib/http.js";
import { verifyUnsub } from "../lib/tokens.js";

// Odhlášení jedním klikem. Dvě cesty:
//  - POST s JSON { t } ze stránky /odhlaseni/
//  - POST na /api/unsubscribe?t=... z poštovního klienta (RFC 8058, hlavička List-Unsubscribe-Post)
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });
  try {
    const q = new URL(req.url, "http://x").searchParams.get("t");
    let t = q;
    if (!t) {
      const b = await body(req).catch(() => ({}));
      t = b.t;
    }
    const id = verifyUnsub(t);
    if (!id) return json(res, 400, { error: "token" });
    const row = await db.findById(id);
    if (!row) return json(res, 400, { error: "token" });
    if (row.status !== "unsubscribed") {
      await db.update(id, {
        status: "unsubscribed",
        unsubscribed_at: new Date().toISOString(),
        confirm_token_hash: null,
        confirm_token_expires_at: null,
        ip_hash: null,
        ip_hash_expires_at: null,
      });
    }
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("unsubscribe failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
