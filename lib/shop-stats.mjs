// Shopify → admin: čtení ze Shopify (jen GraphQL, jen čtení) pro dorovnání a návštěvnost; statistiky z tabulky shop_orders.
// Token přes getShopifyAdminToken (client credentials, jinak SHOPIFY_ADMIN_TOKEN). Webhook HMAC zůstává na SHOPIFY_WEBHOOK_SECRET.
import { fail, supa, restPath, rpc } from "./admin-server.mjs";
import { fromGraphql, summarize } from "./shop-orders.mjs";
import { dropShopifyTokenCache, getShopifyAdminToken, shopifyAdminSettings } from "./shop-token.mjs";

export const LAUNCH_ISO = "2026-11-10T23:00:00Z"; // 11. 11. 2026 00:00 Praha

export function shopConfig(env = process.env) {
  const settings = shopifyAdminSettings(env);
  if (!settings.configured) throw fail(503, "shop_not_configured");
  const cfg = {
    domain: settings.domain,
    token: settings.dynamic ? "" : settings.staticToken,
    version: String(env.SHOPIFY_API_VERSION || "2025-10").trim(),
    dynamic: settings.dynamic,
  };
  // Secret zůstává v closure, ne v poli, které by šlo vypsat nebo serializovat.
  cfg.getToken = (fetchImpl, opts) => getShopifyAdminToken(env, fetchImpl, opts);
  return cfg;
}

async function adminToken(cfg, fetchImpl, force) {
  if (cfg && typeof cfg.getToken === "function") return cfg.getToken(fetchImpl, { force });
  const token = String((cfg && cfg.token) || "").trim();
  if (!token) throw fail(503, "shop_not_configured");
  return token;
}

async function drain(res) {
  try {
    if (res && typeof res.text === "function") await res.text();
  } catch { /* tělo odpovědi se neloguje */ }
}

async function gql(cfg, query, variables, fetchImpl = fetch) {
  const refreshable = Boolean(cfg && cfg.dynamic);
  let force = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await adminToken(cfg, fetchImpl, force);
    const res = await fetchImpl(`https://${cfg.domain}/admin/api/${cfg.version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    if (res && res.status === 401 && refreshable && attempt === 0) {
      await drain(res);
      dropShopifyTokenCache();
      force = true;
      continue;
    }
    if (!res || !res.ok) {
      if (res && res.status === 401) dropShopifyTokenCache();
      await drain(res);
      throw fail(502, "shop_unavailable");
    }
    return res.json();
  }
  throw fail(502, "shop_unavailable");
}

const ORDER_FIELDS = `legacyResourceId name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus
currentTotalPriceSet{shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}} totalRefundedSet{presentmentMoney{amount}}
lineItems(first:50){nodes{quantity}} shippingLines(first:3){nodes{title}} shippingAddress{countryCode}`;
const JOURNEY = "customerJourneySummary{firstVisit{referrerUrl utmParameters{source}}}";
const ordersQuery = (withJourney) => `query($q:String!,$after:String){orders(first:100,after:$after,query:$q,sortKey:CREATED_AT){pageInfo{hasNextPage endCursor} nodes{${ORDER_FIELDS}${withJourney ? " " + JOURNEY : ""}}}}`;

// Dorovnání: načte objednávky od data `sinceIso` a vrátí řádky pro shop_orders.
export async function fetchOrderRows(cfg, sinceIso, fetchImpl = fetch) {
  const rows = [];
  let withJourney = true, after = null;
  for (let i = 0; i < 40; i++) {
    let body = await gql(cfg, ordersQuery(withJourney), { q: `updated_at:>=${sinceIso}`, after }, fetchImpl);
    if (!(body.data && body.data.orders) && withJourney) { withJourney = false; body = await gql(cfg, ordersQuery(false), { q: `updated_at:>=${sinceIso}`, after }, fetchImpl); }
    const page = body.data && body.data.orders;
    if (!page) throw fail(502, "shop_unavailable");
    for (const n of page.nodes) { const r = fromGraphql(n); if (r) rows.push(r); }
    if (!page.pageInfo.hasNextPage) return rows;
    after = page.pageInfo.endCursor;
  }
  return rows;
}

export async function storeRows(rows) {
  for (const r of rows) await rpc("shop_upsert_order", { p: r });
  return rows.length;
}

export async function reconcile({ env = process.env, hours = 48, now = new Date(), fetchImpl = fetch } = {}) {
  const cfg = shopConfig(env);
  const since = new Date(Math.max(new Date(LAUNCH_ISO).getTime(), now.getTime() - hours * 36e5)).toISOString();
  const rows = await fetchOrderRows(cfg, since, fetchImpl);
  await storeRows(rows);
  await supa(restPath("shop_sync", { singleton: "eq.true" }), { method: "PATCH", body: { last_reconcile_at: now.toISOString() }, prefer: "return=minimal" });
  return rows.length;
}

// Návštěvy (ShopifyQL, scope read_reports). Bez oprávnění nebo dat vrací null, ne chybu.
export async function fetchTraffic(cfg, fetchImpl = fetch) {
  const q = "FROM sessions SHOW sessions TIMESERIES day SINCE 2026-11-11 UNTIL today";
  try {
    const body = await gql(cfg, `query($q:String!){shopifyqlQuery(query:$q){parseErrors tableData{columns{name} rows}}}`, { q }, fetchImpl);
    const r = body.data && body.data.shopifyqlQuery;
    if (!r || (r.parseErrors && r.parseErrors.length) || !r.tableData) return null;
    const cols = r.tableData.columns.map((c) => c.name);
    const di = cols.indexOf("day"), si = cols.indexOf("sessions");
    if (di < 0 || si < 0) return null;
    return r.tableData.rows.map((row) => {
      const o = Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row;
      return { day: String(o.day).slice(0, 10), sessions: Number(o.sessions) || 0 };
    });
  } catch {
    return null;
  }
}

export async function shopStats({ env = process.env, now = new Date(), fetchImpl = fetch } = {}) {
  const rows = await supa(restPath("shop_orders", { select: "shopify_id,name,created_at,currency,total,total_czk,items_qty,shipping_method,country,financial_status,referrer,utm_source,cancelled_at,is_test", created_at: "gte." + LAUNCH_ISO, order: "created_at.desc", limit: "5000" }));
  const sync = (await supa(restPath("shop_sync", { select: "last_webhook_at,last_reconcile_at", singleton: "eq.true" })))[0] || {};
  const out = { generatedAt: now.toISOString(), sync, ...summarize(rows, now), traffic: null };
  let cfg = null;
  try { cfg = shopConfig(env); } catch { /* návštěvnost zůstane nedostupná */ }
  if (cfg) {
    const sessions = await fetchTraffic(cfg, fetchImpl);
    if (sessions) {
      const today = sessions.find((s) => s.day === now.toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }));
      const total = sessions.reduce((a, s) => a + s.sessions, 0);
      const conv = (orders, n) => (n ? Math.round((orders / n) * 10000) / 100 : null);
      out.traffic = { today: today ? today.sessions : 0, total, conversion: { today: conv(out.today.orders, today ? today.sessions : 0), total: conv(out.total.orders, total) } };
    }
  }
  return out;
}
