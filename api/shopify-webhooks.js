import { json } from "../lib/http.js";
import { supa, rpc, restPath } from "../lib/admin-server.mjs";
import { verifyHmac, fromWebhook } from "../lib/shop-orders.mjs";

// Vstup webhooků Shopify (jen orders/*). Ověří podpis HMAC nad surovým tělem, uloží agregovatelná data bez osobních údajů.
export const config = { api: { bodyParser: false } };
const TOPICS = new Set(["orders/create", "orders/paid", "orders/updated", "orders/cancelled", "orders/fulfilled", "orders/edited"]);

async function raw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error("size"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  let body;
  try { body = await raw(req); } catch (e) { return json(res, e.status || 400, { error: "body" }); }
  if (!verifyHmac(body, req.headers["x-shopify-hmac-sha256"], process.env.SHOPIFY_WEBHOOK_SECRET)) return json(res, 401, { error: "signature" });
  const shop = String(req.headers["x-shopify-shop-domain"] || "").toLowerCase();
  const expected = String(process.env.SHOPIFY_STORE_DOMAIN || "").toLowerCase();
  if (expected && shop !== expected) return json(res, 401, { error: "shop" });
  const topic = String(req.headers["x-shopify-topic"] || "");
  if (!TOPICS.has(topic)) return json(res, 200, { ignored: true }); // jiná témata nepotřebujeme, Shopify nemá opakovat
  try {
    const row = fromWebhook(JSON.parse(body.toString("utf8")));
    if (!row) return json(res, 200, { ignored: true });
    await rpc("shop_upsert_order", { p: row });
    await supa(restPath("shop_sync", { singleton: "eq.true" }), { method: "PATCH", body: { last_webhook_at: new Date().toISOString() }, prefer: "return=minimal" });
    return json(res, 200, { ok: true });
  } catch {
    return json(res, 500, { error: "store" }); // Shopify zkusí znovu (až 48 h)
  }
}
