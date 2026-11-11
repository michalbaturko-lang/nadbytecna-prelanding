import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { reconcile } from "../lib/shop-stats.mjs";

// Hodinové dorovnání objednávek posledních 48 h proti Shopify (pro případ ztraceného webhooku). Jen čtení ze Shopify.
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method" });
  const expected = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (expected.length < 24 || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return json(res, 401, { error: "auth" });
  try {
    return json(res, 200, { ok: true, orders: await reconcile({ hours: 48 }) });
  } catch (e) {
    return json(res, e.status || 503, { error: e.code || "unavailable" });
  }
}
