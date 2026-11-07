import { cleanClaims, tally } from "../lib/claims.js";
import { db } from "../lib/db.js";
import { body, bodyError, isDemo, json, originOk, phase1Closed } from "../lib/http.js";
import { verifyVote } from "../lib/tokens.js";

// GET  /api/vote/ -> souhrnné počty (bez osobních údajů)
// POST /api/vote/ { v, claims:[id,...] } -> uloží výběr k potvrzenému e-mailu a vrátí počty.
// V ukázkovém režimu (*.vercel.app, sběr zavřený) se nic neukládá a počty jsou jen ukázka.
// Souhrn se drží 30 s v paměti instance, aby veřejný GET nemohl zahltit databázi (každé volání by jinak čte všechny řádky).
let cache = { at: 0, out: null };
async function publicTally() {
  const now = Date.now();
  if (cache.out && now - cache.at < 30_000) return cache.out;
  cache = { at: now, out: tally(await db.confirmedClaims()) };
  return cache.out;
}

export default async function handler(req, res) {
  if (phase1Closed(res)) return;
  if (req.method === "GET") {
    if (isDemo(req)) return json(res, 200, { ...tally([]), demo: true });
    try { return json(res, 200, await publicTally()); }
    catch (e) { console.error("votes failed", e.message); return json(res, 500, { error: "server" }); }
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });
  let b;
  try { b = await body(req); } catch (e) { return bodyError(res, e); }
  try {
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
    cache = { at: 0, out: null };
    return json(res, 200, { ok: true, ...(await publicTally()) });
  } catch (e) {
    console.error("vote failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
