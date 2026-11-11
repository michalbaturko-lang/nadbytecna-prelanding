// Admin API token pro Shopify. Client credentials grant, když jsou SHOPIFY_CLIENT_ID a SHOPIFY_CLIENT_SECRET,
// jinak statický SHOPIFY_ADMIN_TOKEN. Cache jen v paměti modulu. Token ani secret se nikdy nelogují.
import { fail } from "./admin-server.mjs";

const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SKEW_MS = 5 * 60 * 1000;

let memory = null; // { key, token, exp }

const trimmed = (env, key) => String((env && env[key]) || "").trim();

export function dropShopifyTokenCache() {
  memory = null;
}

export function usesShopifyClientCredentials(env) {
  return Boolean(trimmed(env, "SHOPIFY_CLIENT_ID") && trimmed(env, "SHOPIFY_CLIENT_SECRET"));
}

// Bez client secret. shopConfig podle toho pozná, jestli je obchod nastavený, a nevidí secret.
export function shopifyAdminSettings(env = process.env) {
  const domain = trimmed(env, "SHOPIFY_STORE_DOMAIN").toLowerCase();
  const dynamic = usesShopifyClientCredentials(env);
  const staticToken = trimmed(env, "SHOPIFY_ADMIN_TOKEN");
  return {
    domain,
    dynamic,
    staticToken,
    configured: DOMAIN_RE.test(domain) && (dynamic || Boolean(staticToken)),
  };
}

export async function getShopifyAdminToken(env = process.env, fetchImpl = fetch, { force = false, now = Date.now() } = {}) {
  const settings = shopifyAdminSettings(env);
  if (!settings.configured) throw fail(503, "shop_not_configured");
  if (!settings.dynamic) return settings.staticToken;

  const clientId = trimmed(env, "SHOPIFY_CLIENT_ID");
  const clientSecret = trimmed(env, "SHOPIFY_CLIENT_SECRET");
  const key = settings.domain + "\0" + clientId;
  if (!force && memory && memory.key === key && memory.exp > now) return memory.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  let res;
  try {
    res = await fetchImpl(`https://${settings.domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw fail(502, "shop_unavailable");
  }
  if (!res || res.ok !== true) throw fail(502, "shop_unavailable");
  let data;
  try { data = await res.json(); } catch { throw fail(502, "shop_unavailable"); }
  const token = data && typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!token) throw fail(502, "shop_unavailable");
  const expiresIn = Number(data.expires_in);
  const ttlMs = Number.isFinite(expiresIn) ? expiresIn * 1000 - SKEW_MS : 0;
  memory = ttlMs > 0 ? { key, token, exp: now + ttlMs } : null;
  return token;
}
