import { db } from "../lib/db.js";
import { body, bodyError, json, originOk, phase1Closed } from "../lib/http.js";
import { sha256, signVote } from "../lib/tokens.js";

// Potvrzení e-mailu je POST po kliknutí na tlačítko na stránce /potvrzeni/ (ne GET z odkazu),
// aby e-mailové skenery odkazů nepotvrzovaly adresy za ženy.
export default async function handler(req, res) {
  if (phase1Closed(res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });
  let b;
  try { b = await body(req); } catch (e) { return bodyError(res, e); }
  try {
    const t = b.t;
    if (typeof t !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(t)) return json(res, 400, { error: "token" });
    const row = await db.findByTokenHash(sha256(t));
    if (!row) return json(res, 400, { error: "token" });
    if (row.status === "confirmed") return json(res, 200, { ok: true, vote: signVote(row.id) });
    if (row.status !== "pending" || Date.parse(row.confirm_token_expires_at) < Date.now()) return json(res, 400, { error: "token" });
    await db.update(row.id, { status: "confirmed", confirmed_at: new Date().toISOString() });
    return json(res, 200, { ok: true, vote: signVote(row.id) });
  } catch (e) {
    console.error("confirm failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
