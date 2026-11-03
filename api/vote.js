import { cleanClaims, tally } from "../lib/claims.js";
import { db } from "../lib/db.js";
import { body, isDemo, json, originOk } from "../lib/http.js";
import { verifyVote } from "../lib/tokens.js";

// GET  /api/vote/ -> souhrnné počty (bez osobních údajů)
// POST /api/vote/ { v, claims:[id,...] } -> uloží výběr k potvrzenému e-mailu a vrátí počty.
// V ukázkovém režimu (*.vercel.app, sběr zavřený) se nic neukládá a počty jsou jen ukázka.
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (isDemo(req)) return json(res, 200, { ...tally([]), demo: true });
    try {
      const out = tally(await db.confirmedClaims());
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
      return json(res, 200, out);
    } catch (e) { console.error("votes failed", e.message); return json(res, 500, { error: "server" }); }
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });
  try {
    const b = await body(req);
    const claims = cleanClaims(b.claims);
    if (!claims) return json(res, 400, { error: "claims" });
    if (isDemo(req)) {
      const t = tally([{ claims }]);
      return json(res, 200, { ok: true, demo: true, ...t });
    }
    const id = verifyVote(b.v);
    if (!id) return json(res, 400, { error: "token" });
    const row = await db.findById(id);
    if (!row || row.status !== "confirmed") return json(res, 400, { error: "token" });
    await db.update(id, { claims, claims_at: new Date().toISOString() });
    return json(res, 200, { ok: true, ...tally(await db.confirmedClaims()) });
  } catch (e) {
    console.error("vote failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
