import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { shopConfig, fetchOrderRows, fetchTraffic } from "../lib/shop-stats.mjs";
import { verifyHmac, fromWebhook, fromGraphql, summarize } from "../lib/shop-orders.mjs";
import webhook from "../api/shopify-webhooks.js";
import adminShop from "../api/admin-shop.js";

const NOW = new Date("2026-11-11T12:00:00Z");
const hook = (over = {}) => ({
  id: 1001, name: "#1001", created_at: "2026-11-11T08:00:00+01:00", updated_at: "2026-11-11T08:00:05+01:00",
  current_total_price: "1111.00", presentment_currency: "CZK",
  current_total_price_set: { shop_money: { amount: "1111.00", currency_code: "CZK" }, presentment_money: { amount: "1111.00", currency_code: "CZK" } },
  financial_status: "paid", fulfillment_status: null, line_items: [{ quantity: 1 }],
  shipping_lines: [{ title: "PPL" }], shipping_address: { country_code: "CZ", first_name: "Jana", address1: "Ulice 1" },
  email: "zakaznik@example.com", phone: "+420123456789", customer: { first_name: "Jana" },
  referring_site: "https://www.instagram.com/", landing_site: "/?utm_source=ig", test: false, ...over,
});

test("konfigurace vyžaduje doménu myshopify a token", () => {
  assert.throws(() => shopConfig({}), (e) => e.status === 503 && e.code === "shop_not_configured");
  assert.throws(() => shopConfig({ SHOPIFY_STORE_DOMAIN: "evil.example.com", SHOPIFY_ADMIN_TOKEN: "x" }));
  assert.equal(shopConfig({ SHOPIFY_STORE_DOMAIN: "qhq4hi-z0.myshopify.com", SHOPIFY_ADMIN_TOKEN: "x" }).version, "2025-10");
});

test("HMAC: platný podpis projde, změněné tělo, špatný secret a chybějící hlavička ne", () => {
  const body = Buffer.from('{"id":1}');
  const sig = crypto.createHmac("sha256", "secret").update(body).digest("base64");
  assert.equal(verifyHmac(body, sig, "secret"), true);
  assert.equal(verifyHmac(Buffer.from('{"id":2}'), sig, "secret"), false);
  assert.equal(verifyHmac(body, sig, "jiny"), false);
  assert.equal(verifyHmac(body, "", "secret"), false);
  assert.equal(verifyHmac(body, sig, ""), false);
});

test("webhook payload → řádek bez osobních údajů", () => {
  const r = fromWebhook(hook());
  assert.equal(r.shopify_id, 1001);
  assert.equal(r.total_czk, 1111);
  assert.equal(r.country, "CZ");
  assert.equal(r.shipping_method, "PPL");
  assert.equal(r.referrer, "instagram.com");
  assert.equal(r.utm_source, "ig");
  assert.equal(r.financial_status, "PAID");
  const text = JSON.stringify(r);
  for (const pii of ["zakaznik@example.com", "+420123456789", "Jana", "Ulice"]) assert.ok(!text.includes(pii), pii);
  const sk = fromWebhook(hook({ id: 1002, current_total_price_set: { shop_money: { amount: "1150.00", currency_code: "CZK" }, presentment_money: { amount: "45.90", currency_code: "EUR" } }, shipping_address: { country_code: "SK" } }));
  assert.equal(sk.currency, "EUR");
  assert.equal(sk.total, 45.9);
  assert.equal(sk.total_czk, 1150);
  assert.equal(sk.country, "SK");
});

test("GraphQL uzel → stejný tvar řádku", () => {
  const r = fromGraphql({ legacyResourceId: "1003", name: "#1003", createdAt: "2026-11-11T09:00:00Z", updatedAt: "2026-11-11T09:00:01Z", cancelledAt: null, test: false,
    displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
    currentTotalPriceSet: { shopMoney: { amount: "1111.0", currencyCode: "CZK" }, presentmentMoney: { amount: "1111.0", currencyCode: "CZK" } },
    totalRefundedSet: { presentmentMoney: { amount: "0.0" } }, lineItems: { nodes: [{ quantity: 2 }] }, shippingLines: { nodes: [{ title: "Zásilkovna" }] }, shippingAddress: { countryCode: "CZ" },
    customerJourneySummary: { firstVisit: { referrerUrl: "https://l.facebook.com/x", utmParameters: { source: "fb" } } } });
  assert.equal(r.shopify_id, 1003);
  assert.equal(r.items_qty, 2);
  assert.equal(r.referrer, "l.facebook.com");
  assert.equal(r.utm_source, "fb");
});

test("souhrn: dnes v Praze, CZ/SK, doprava, stavy, bez zrušených a testovacích", () => {
  const row = (o) => ({ shopify_id: 1, name: "#1", created_at: "2026-11-11T08:00:00Z", currency: "CZK", total: 1111, total_czk: 1111, items_qty: 1, shipping_method: "PPL", country: "CZ", financial_status: "PAID", referrer: null, utm_source: null, cancelled_at: null, is_test: false, ...o });
  const s = summarize([
    row({}), row({ total: 45.9, currency: "EUR", total_czk: 1150, country: "SK", shipping_method: "Zásilkovna", utm_source: "ig" }),
    row({ created_at: "2026-11-10T23:30:00Z" }), // v Praze už 11. 11. 00:30
    row({ created_at: "2026-11-10T20:00:00Z" }), // 10. 11. v Praze: nednes
    row({ cancelled_at: "2026-11-11T09:00:00Z" }), row({ is_test: true }), row({ financial_status: "PENDING" }), row({ financial_status: "REFUNDED" }),
  ], NOW);
  assert.equal(s.today.orders, 5); // 2 běžné + půlnoc + pending + refunded
  assert.equal(s.total.orders, 6);
  assert.equal(s.countries.SK.orders, 1);
  assert.equal(s.countries.SK.by_currency.EUR.amount, 45.9);
  assert.equal(s.shipping[0].key, "PPL");
  assert.deepEqual(s.status, { paid: 4, pending: 1, cancelled: 1, refunded: 1 });
  assert.equal(s.hourly.length, 24);
  assert.ok(s.last && s.last.name);
});

test("dorovnání čte jen objednávky a nežádá osobní pole; bez journey se vrací k základnímu dotazu", async () => {
  const queries = [];
  const fetchImpl = async (url, init) => {
    const { query } = JSON.parse(init.body);
    queries.push(query);
    if (query.includes("customerJourneySummary")) return { ok: true, json: async () => ({ errors: [{ message: "Access denied" }] }) };
    return { ok: true, json: async () => ({ data: { orders: { pageInfo: { hasNextPage: false }, nodes: [{ legacyResourceId: "5", name: "#5", createdAt: "2026-11-11T09:00:00Z", currentTotalPriceSet: { shopMoney: { amount: "1", currencyCode: "CZK" }, presentmentMoney: { amount: "1", currencyCode: "CZK" } } }] } } }) };
  };
  const rows = await fetchOrderRows({ domain: "qhq4hi-z0.myshopify.com", token: "t", version: "2025-10" }, "2026-11-11T00:00:00Z", fetchImpl);
  assert.equal(rows.length, 1);
  assert.equal(queries.length, 2);
  for (const q of queries) assert.ok(!/email|phone|firstName|lastName|address1|customer\{|billingAddress/i.test(q), q);
});

test("návštěvnost bez oprávnění vrací null", async () => {
  const cfg = { domain: "qhq4hi-z0.myshopify.com", token: "t", version: "2025-10" };
  assert.equal(await fetchTraffic(cfg, async () => ({ ok: true, json: async () => ({ errors: [{ message: "Access denied" }] }) })), null);
  const ok = await fetchTraffic(cfg, async () => ({ ok: true, json: async () => ({ data: { shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: "day" }, { name: "sessions" }], rows: [{ day: "2026-11-11", sessions: "40" }] } } } }) }));
  assert.deepEqual(ok, [{ day: "2026-11-11", sessions: 40 }]);
});

const mkRes = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
const stream = (body, headers) => Object.assign((async function* () { yield body; })(), { method: "POST", headers });

test("webhook: špatný podpis 401, jiný obchod 401, cizí téma ignorováno, platný uloží přes RPC", async () => {
  process.env.SHOPIFY_WEBHOOK_SECRET = "s3cret";
  process.env.SHOPIFY_STORE_DOMAIN = "qhq4hi-z0.myshopify.com";
  process.env.SUPABASE_URL = "https://db.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  const body = Buffer.from(JSON.stringify(hook()));
  const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("base64");
  const base = { "x-shopify-hmac-sha256": sig, "x-shopify-shop-domain": "qhq4hi-z0.myshopify.com", "x-shopify-topic": "orders/create" };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return { ok: true, status: 200, text: async () => "" }; };
  try {
    let res = mkRes(); await webhook(stream(body, { ...base, "x-shopify-hmac-sha256": "AAAA" }), res);
    assert.equal(res.statusCode, 401);
    res = mkRes(); await webhook(stream(body, { ...base, "x-shopify-shop-domain": "jiny.myshopify.com" }), res);
    assert.equal(res.statusCode, 401);
    res = mkRes(); await webhook(stream(body, { ...base, "x-shopify-topic": "customers/create" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 0);
    res = mkRes(); await webhook(stream(body, base), res);
    assert.equal(res.statusCode, 200);
    const rpc = calls.find((c) => c.url.includes("/rpc/shop_upsert_order"));
    assert.ok(rpc);
    assert.ok(!rpc.body.includes("zakaznik@example.com") && !rpc.body.includes("Jana"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("admin endpoint odmítne GET a požadavek bez přihlášení", async () => {
  let res = mkRes(); await adminShop({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = mkRes(); await adminShop({ method: "POST", headers: { host: "nadbytecna.cz" }, body: { action: "stats" } }, res);
  assert.equal(res.statusCode, 401);
});

test("migrace: tabulka bez osobních sloupců, starší webhook nepřepíše novější stav", async () => {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(fs.readFileSync(new URL("../supabase/migrations/20261111210000_shop_orders.sql", import.meta.url), "utf8"));
  const cols = (await db.query("select column_name from information_schema.columns where table_name='shop_orders'")).rows.map((r) => r.column_name);
  for (const bad of ["email", "phone", "first_name", "last_name", "address", "customer"]) assert.ok(!cols.some((c) => c.includes(bad)), bad);
  const rls = (await db.query("select relrowsecurity from pg_class where relname='shop_orders'")).rows[0];
  assert.equal(rls.relrowsecurity, true);
  const r1 = fromWebhook(hook({ updated_at: "2026-11-11T10:00:00Z", financial_status: "paid" }));
  const r0 = fromWebhook(hook({ updated_at: "2026-11-11T09:00:00Z", financial_status: "pending" }));
  await db.query("select public.shop_upsert_order($1::jsonb)", [JSON.stringify(r1)]);
  await db.query("select public.shop_upsert_order($1::jsonb)", [JSON.stringify(r0)]); // opožděný starší webhook
  await db.query("select public.shop_upsert_order($1::jsonb)", [JSON.stringify(r1)]); // opakované doručení
  const rows = (await db.query("select financial_status from public.shop_orders")).rows;
  assert.deepEqual(rows, [{ financial_status: "PAID" }]);
});
