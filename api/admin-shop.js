import { json } from "../lib/http.js";
import { authorize, audit, readBody, checkOrigin, fail } from "../lib/admin-server.mjs";
import { shopStats } from "../lib/shop-stats.mjs";

// Statistiky e-shopu pro přihlášené administrátory. Vrací jen agregáty, žádné údaje zákazníků.
export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  try {
    checkOrigin(req);
    const user = await authorize(req);
    const b = await readBody(req);
    if (b.action !== "stats") throw fail(400, "action");
    const stats = await shopStats();
    await audit(user, "view_shop_stats", null, null, {}).catch(() => {});
    return json(res, 200, stats);
  } catch (e) {
    return json(res, e.status || 503, { error: e.code || "unavailable" });
  }
}
