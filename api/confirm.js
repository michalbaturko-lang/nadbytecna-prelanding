import { db } from "../lib/db.js";
import { body, json, originOk } from "../lib/http.js";
import { sha256 } from "../lib/tokens.js";

// Potvrzení e-mailu je POST po kliknutí na tlačítko na stránce /potvrzeni/ (ne GET z odkazu),
// aby e-mailové skenery odkazů nepotvrzovaly adresy za ženy.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });
  try {
    const { t } = await body(req);
    if (typeof t !== "string" || t.length < 20 || t.length > 100) return json(res, 400, { error: "token" });
    const row = await db.findByTokenHash(sha256(t));
    if (!row) return json(res, 400, { error: "token" });
    if (row.status === "confirmed") return json(res, 200, { ok: true });
    if (row.status !== "pending" || Date.parse(row.confirm_token_expires_at) < Date.now()) return json(res, 400, { error: "token" });
    await db.update(row.id, { status: "confirmed", confirmed_at: new Date().toISOString() });
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("confirm failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
