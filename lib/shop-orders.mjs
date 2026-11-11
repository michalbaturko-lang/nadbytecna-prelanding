// Převod objednávky Shopify (webhook REST i GraphQL) na řádek shop_orders. Žádná osobní data zákazníka.
import crypto from "node:crypto";

export function verifyHmac(rawBody, header, secret) {
  if (!secret || !header || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  let got;
  try { got = Buffer.from(String(header), "base64"); } catch { return false; }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, "").slice(0, 120); } catch { return null; } };
const utm = (landing) => { try { return new URL(landing, "https://x.invalid").searchParams.get("utm_source")?.slice(0, 80) || null; } catch { return null; } };
const FIN = { paid: "PAID", pending: "PENDING", authorized: "AUTHORIZED", refunded: "REFUNDED", partially_refunded: "PARTIALLY_REFUNDED", voided: "VOIDED", partially_paid: "PARTIALLY_PAID" };
const FUL = { fulfilled: "FULFILLED", partial: "PARTIALLY_FULFILLED", restocked: "RESTOCKED" };

// REST payload webhooků orders/* (snake_case).
export function fromWebhook(o) {
  if (!o || !o.id || !o.created_at) return null;
  const set = o.current_total_price_set || o.total_price_set || {};
  const shop = num((set.shop_money && set.shop_money.amount) ?? o.current_total_price ?? o.total_price);
  const pres = set.presentment_money || {};
  const currency = String(pres.currency_code || o.presentment_currency || o.currency || "CZK").toUpperCase();
  const refunded = (o.refunds || []).flatMap((r) => r.transactions || []).filter((t) => t.kind === "refund" && t.status !== "failure").reduce((a, t) => a + num(t.amount), 0);
  return {
    shopify_id: Number(o.id),
    name: String(o.name || "#" + o.order_number || o.id).slice(0, 40),
    created_at: o.created_at,
    shopify_updated_at: o.updated_at || o.created_at,
    currency,
    total: num(pres.amount ?? o.current_total_price ?? o.total_price),
    total_czk: shop,
    refunded_amount: refunded,
    items_qty: (o.line_items || []).reduce((a, l) => a + num(l.quantity), 0),
    shipping_method: ((o.shipping_lines || [])[0] || {}).title?.slice(0, 120) || null,
    country: /^[A-Za-z]{2}$/.test((o.shipping_address || {}).country_code || "") ? o.shipping_address.country_code.toUpperCase() : null,
    financial_status: FIN[o.financial_status] || (o.financial_status ? String(o.financial_status).toUpperCase() : null),
    fulfillment_status: FUL[o.fulfillment_status] || "UNFULFILLED",
    referrer: host(o.referring_site),
    utm_source: utm(o.landing_site),
    cancelled_at: o.cancelled_at || null,
    is_test: o.test === true,
  };
}

// GraphQL uzel objednávky (camelCase), použitý při dorovnání.
export function fromGraphql(n) {
  if (!n || !n.legacyResourceId || !n.createdAt) return null;
  const set = n.currentTotalPriceSet || {};
  const pres = set.presentmentMoney || {};
  const first = (n.customerJourneySummary && n.customerJourneySummary.firstVisit) || {};
  return {
    shopify_id: Number(n.legacyResourceId),
    name: String(n.name || n.legacyResourceId).slice(0, 40),
    created_at: n.createdAt,
    shopify_updated_at: n.updatedAt || n.createdAt,
    currency: String(pres.currencyCode || (set.shopMoney && set.shopMoney.currencyCode) || "CZK").toUpperCase(),
    total: num(pres.amount ?? (set.shopMoney ? set.shopMoney.amount : undefined)),
    total_czk: num(set.shopMoney && set.shopMoney.amount),
    refunded_amount: num(n.totalRefundedSet && n.totalRefundedSet.presentmentMoney && n.totalRefundedSet.presentmentMoney.amount),
    items_qty: ((n.lineItems && n.lineItems.nodes) || []).reduce((a, l) => a + num(l.quantity), 0),
    shipping_method: (((n.shippingLines && n.shippingLines.nodes) || [])[0] || {}).title?.slice(0, 120) || null,
    country: /^[A-Za-z]{2}$/.test((n.shippingAddress || {}).countryCode || "") ? n.shippingAddress.countryCode.toUpperCase() : null,
    financial_status: n.displayFinancialStatus || null,
    fulfillment_status: n.displayFulfillmentStatus || null,
    referrer: host(first.referrerUrl),
    utm_source: (first.utmParameters && first.utmParameters.source ? String(first.utmParameters.source).slice(0, 80) : null),
    cancelled_at: n.cancelledAt || null,
    is_test: n.test === true,
  };
}

const TZ = "Europe/Prague";
export const dayKey = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const hourOf = (iso) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;

// Agregace řádků shop_orders. „Dnes“ = kalendářní den v Praze. Zrušené a testovací se do obratu nepočítají.
export function summarize(rows, now = new Date()) {
  const today = dayKey(now.toISOString());
  const live = rows.filter((r) => !r.is_test);
  const valid = live.filter((r) => !r.cancelled_at);
  const sum = (list) => {
    const byCur = {};
    for (const r of list) { const c = byCur[r.currency] || (byCur[r.currency] = { orders: 0, amount: 0 }); c.orders += 1; c.amount += Number(r.total); }
    const czk = list.reduce((a, r) => a + Number(r.total_czk), 0);
    return {
      orders: list.length,
      units: list.reduce((a, r) => a + (r.items_qty || 0), 0),
      czk: Math.round(czk),
      average_czk: list.length ? Math.round(czk / list.length) : 0,
      by_currency: Object.fromEntries(Object.entries(byCur).map(([k, v]) => [k, { orders: v.orders, amount: Math.round(v.amount * 100) / 100 }])),
    };
  };
  const count = (list, f) => { const m = {}; for (const r of list) { const k = f(r) || "neuvedeno"; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([key, orders]) => ({ key, orders })); };
  const days = new Map();
  for (const r of valid) { const k = dayKey(r.created_at); const d = days.get(k) || { day: k, orders: 0, czk: 0 }; d.orders += 1; d.czk += Number(r.total_czk); days.set(k, d); }
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  for (const r of valid) hours[hourOf(r.created_at)].orders += 1;
  const country = (c) => sum(valid.filter((r) => r.country === c));
  const last = [...valid].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  const financial = { paid: 0, pending: 0, cancelled: 0, refunded: 0 };
  for (const r of live) {
    if (r.cancelled_at) financial.cancelled += 1;
    else if (/REFUNDED/.test(r.financial_status || "")) financial.refunded += 1;
    else if (r.financial_status === "PAID") financial.paid += 1;
    else financial.pending += 1;
  }
  return {
    today: sum(valid.filter((r) => dayKey(r.created_at) === today)),
    total: sum(valid),
    countries: { CZ: country("CZ"), SK: country("SK") },
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, czk: Math.round(d.czk) })),
    hourly: hours,
    shipping: count(valid, (r) => r.shipping_method),
    status: financial,
    sources: count(valid, (r) => r.utm_source || r.referrer || "přímý vstup").slice(0, 8),
    last: last ? { name: last.name, at: last.created_at, total: Number(last.total), currency: last.currency, country: last.country } : null,
  };
}
