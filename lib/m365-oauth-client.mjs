// Server-only delegated OAuth client. The caller owns one-time state/PKCE validation,
// verifies Graph /me against the intended mailbox, and persists only encrypted cache.
// Official APIs: MSAL Node getAuthCodeUrl, acquireTokenByCode, acquireTokenSilent,
// getTokenCache().serialize()/deserialize()/getAccountByHomeId().
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REDIRECT = "https://nadbytecna.cz/api/mail-connect/?step=callback";
const MAILBOX = "veryvera@nadbytecna.cz";
const SCOPES = Object.freeze(["User.Read", "Mail.Read"]);
const MAX_CACHE_BYTES = 1024 * 1024;
const B64 = /^[A-Za-z0-9_-]+$/;
export function m365OAuthError(code) {
  return Object.assign(
    new Error("Microsoft 365 connection operation failed."),
    { name: "M365OAuthError", code },
  );
}
function encryptionKey(env) {
  const value = env.M365_TOKEN_ENCRYPTION_KEY;
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw m365OAuthError("oauth_configuration");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw m365OAuthError("oauth_configuration");
  return key;
}
function validatedRedirect(env) {
  const value = env.M365_OAUTH_REDIRECT_URI;
  if (value === REDIRECT) return new URL(REDIRECT);
  if (
    env.VERCEL_ENV !== "preview" ||
    env.M365_OAUTH_ALLOW_PREVIEW !== "true" ||
    typeof value !== "string"
  )
    throw m365OAuthError("oauth_configuration");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw m365OAuthError("oauth_configuration");
  }
  // Match the original authority too: URL normalizes explicit :443 away.
  const authority = /^https:\/\/([^/]+)\//.exec(value)?.[1];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !authority ||
    authority !== url.hostname ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(url.hostname) ||
    url.pathname !== "/api/mail-connect/" ||
    url.search !== "?step=callback" ||
    value !== url.href
  )
    throw m365OAuthError("oauth_configuration");
  return url;
}
export function readM365OAuthConfig(env = process.env) {
  const tenantId =
      typeof env.M365_TENANT_ID === "string"
        ? env.M365_TENANT_ID.toLowerCase()
        : "",
    clientId =
      typeof env.M365_CLIENT_ID === "string"
        ? env.M365_CLIENT_ID.toLowerCase()
        : "";
  if (
    env.M365_AUTH_MODE !== "delegated" ||
    !GUID.test(tenantId || "") ||
    !GUID.test(clientId || "") ||
    env.M365_MAILBOX !== MAILBOX ||
    typeof env.M365_CLIENT_SECRET !== "string" ||
    !env.M365_CLIENT_SECRET ||
    env.M365_CLIENT_SECRET.length > 4096 ||
    /\s/.test(env.M365_CLIENT_SECRET)
  )
    throw m365OAuthError("oauth_configuration");
  encryptionKey(env);
  const redirect = validatedRedirect(env);
  return {
    tenantId,
    clientId,
    authority: "https://login.microsoftonline.com/" + tenantId,
    redirectUri: redirect.href,
    publicOrigin: redirect.origin,
    mailbox: MAILBOX,
    scopes: [...SCOPES],
  };
}
function enabled(env, purpose) {
  return (
    env.M365_AUTH_MODE === "delegated" &&
    env[
      purpose === "refresh" ? "M365_INGEST_ENABLED" : "M365_CONNECT_ENABLED"
    ] === "true"
  );
}
function validCache(cache) {
  if (
    typeof cache !== "string" ||
    !cache ||
    Buffer.byteLength(cache, "utf8") > MAX_CACHE_BYTES
  )
    throw m365OAuthError("oauth_cache_invalid");
  let value;
  try {
    value = JSON.parse(cache);
  } catch {
    throw m365OAuthError("oauth_cache_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw m365OAuthError("oauth_cache_invalid");
  return cache;
}
function aad(env, context) {
  const config = readM365OAuthConfig(env);
  if (
    typeof context !== "string" ||
    !context ||
    Buffer.byteLength(context, "utf8") > 1024 ||
    context.includes("\0")
  )
    throw m365OAuthError("oauth_encryption_context");
  return Buffer.from(
    JSON.stringify([
      "nadbytecna:m365:v1",
      config.tenantId.toLowerCase(),
      config.clientId.toLowerCase(),
      MAILBOX,
      context,
    ]),
    "utf8",
  );
}
export function encryptM365Cache({ cache, env = process.env, context } = {}) {
  // Also used for encrypted PKCE state: arbitrary bounded plaintext, never a browser payload.
  if (
    typeof cache !== "string" ||
    !cache ||
    Buffer.byteLength(cache, "utf8") > MAX_CACHE_BYTES
  )
    throw m365OAuthError("oauth_cache_invalid");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(aad(env, context));
  const encrypted = Buffer.concat([
    cipher.update(cache, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptM365Cache({
  encrypted,
  env = process.env,
  context,
} = {}) {
  if (
    typeof encrypted !== "string" ||
    encrypted.length > Math.ceil((MAX_CACHE_BYTES * 4) / 3) + 100
  )
    throw m365OAuthError("oauth_cache_invalid");
  const parts = encrypted.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "v1" ||
    parts.slice(1).some((p) => !p || !B64.test(p))
  )
    throw m365OAuthError("oauth_cache_invalid");
  const decoded = parts.slice(1).map((p) => Buffer.from(p, "base64url"));
  if (
    decoded.some((b, i) => b.toString("base64url") !== parts[i + 1]) ||
    decoded[0].length !== 12 ||
    decoded[1].length !== 16 ||
    decoded[2].length > MAX_CACHE_BYTES
  )
    throw m365OAuthError("oauth_cache_invalid");
  const key = encryptionKey(env),
    additional = aad(env, context);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decoded[0]);
    decipher.setAAD(additional);
    decipher.setAuthTag(decoded[1]);
    return Buffer.concat([
      decipher.update(decoded[2]),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw m365OAuthError("oauth_cache_decryption_failed");
  }
}
function safeNetworkUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw m365OAuthError("oauth_network_blocked");
  }
  if (
    u.protocol !== "https:" ||
    u.host !== "login.microsoftonline.com" ||
    u.username ||
    u.password ||
    u.hash
  )
    throw m365OAuthError("oauth_network_blocked");
  return u.href;
}
// MSAL's supported INetworkModule transport keeps redirects/errors from exposing secrets.
function networkClient(fetcher) {
  async function request(method, url, options = {}) {
    const target = safeNetworkUrl(url);
    let r;
    try {
      r = await fetcher(target, {
        method,
        headers: options.headers,
        body: method === "POST" ? options.body : undefined,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw m365OAuthError("oauth_network_failed");
    }
    if (r.redirected) throw m365OAuthError("oauth_network_failed");
    const limit = 1024 * 1024;
    let raw;
    try {
      if (Number(r.headers.get("content-length")) > limit) throw new Error();
      if (r.body?.getReader) {
        const reader = r.body.getReader(),
          chunks = [];
        let n = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            n += value.byteLength;
            if (n > limit) {
              await reader.cancel();
              throw new Error();
            }
            chunks.push(Buffer.from(value));
          }
          raw = Buffer.concat(chunks).toString("utf8");
        } finally {
          reader.releaseLock();
        }
      } else {
        raw = await r.text();
        if (Buffer.byteLength(raw) > limit) throw new Error();
      }
      return {
        headers: Object.fromEntries(r.headers.entries()),
        status: r.status,
        body: JSON.parse(raw),
      };
    } catch {
      throw m365OAuthError("oauth_network_failed");
    }
  }
  return {
    sendGetRequestAsync: (url, options) => request("GET", url, options),
    sendPostRequestAsync: (url, options) => request("POST", url, options),
  };
}
async function clientFor(config, env, msalFactory, fetcher) {
  const options = {
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      clientSecret: env.M365_CLIENT_SECRET,
    },
    system: {
      networkClient: networkClient(fetcher),
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
    },
  };
  if (msalFactory) return await msalFactory(options);
  const { ConfidentialClientApplication } = await import("@azure/msal-node");
  return new ConfidentialClientApplication(options);
}
function opaque(value, min, max, pattern) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    !pattern.test(value)
  )
    throw m365OAuthError("oauth_request_invalid");
  return value;
}
function normalizeResult(result, config, cache, requestedAccount) {
  const accountId = result?.account?.homeAccountId,
    tenantId = result?.tenantId;
  if (
    typeof accountId !== "string" ||
    !accountId ||
    accountId.length > 1024 ||
    !GUID.test(tenantId || "") ||
    tenantId.toLowerCase() !== config.tenantId.toLowerCase() ||
    (requestedAccount && accountId !== requestedAccount) ||
    typeof result.accessToken !== "string" ||
    !result.accessToken ||
    result.accessToken.length > 32768 ||
    /\s/.test(result.accessToken)
  )
    throw m365OAuthError("oauth_identity_invalid");
  const granted = new Set(
    (Array.isArray(result.scopes) ? result.scopes : [])
      .filter((s) => typeof s === "string")
      .map((s) =>
        s.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, ""),
      ),
  );
  if (!granted.has("user.read") || !granted.has("mail.read"))
    throw m365OAuthError("oauth_scope_missing");
  return {
    enabled: true,
    cache: validCache(cache.serialize()),
    accountId,
    tenantId,
    accessToken: result.accessToken,
  };
}
function redact(error, fallback) {
  if (error?.name === "M365OAuthError") return error;
  // MSAL ServerError exposes the first Entra error_codes item as errorNo.
  // Classify only fixed machine codes; never inspect or retain server descriptions.
  if (
    ["invalid_client", "invalid_client_credential"].includes(error?.errorCode) ||
    [7000215, 7000222, "7000215", "7000222"].includes(error?.errorNo)
  )
    return m365OAuthError("oauth_client_rejected");
  if (
    [
      "interaction_required",
      "consent_required",
      "login_required",
      "invalid_grant",
    ].includes(error?.errorCode)
  )
    return m365OAuthError("oauth_reauth_required");
  return m365OAuthError(fallback);
}
export async function getAuthUrl({
  state,
  codeChallenge,
  env = process.env,
  msalFactory,
  fetcher = fetch,
} = {}) {
  if (!enabled(env, "connect")) return { enabled: false };
  const config = readM365OAuthConfig(env);
  opaque(state, 32, 512, /^[A-Za-z0-9_-]+$/);
  opaque(codeChallenge, 43, 43, B64);
  try {
    const client = await clientFor(config, env, msalFactory, fetcher);
    const url = await client.getAuthCodeUrl({
      scopes: [...SCOPES],
      redirectUri: config.redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
      responseMode: "query",
      loginHint: MAILBOX,
      prompt: "select_account",
    });
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://login.microsoftonline.com" ||
      parsed.pathname !== "/" + config.tenantId + "/oauth2/v2.0/authorize" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      throw m365OAuthError("oauth_authorize_url_invalid");
    return { enabled: true, url };
  } catch (e) {
    throw redact(e, "oauth_authorize_failed");
  }
}
export async function exchangeCode({
  code,
  codeVerifier,
  cache,
  env = process.env,
  msalFactory,
  fetcher = fetch,
} = {}) {
  if (!enabled(env, "connect")) return { enabled: false };
  const config = readM365OAuthConfig(env);
  opaque(code, 1, 8192, /^[\x21-\x7e]+$/);
  opaque(codeVerifier, 43, 128, /^[A-Za-z0-9._~-]+$/);
  if (cache !== undefined) validCache(cache);
  try {
    const client = await clientFor(config, env, msalFactory, fetcher),
      tokenCache = client.getTokenCache();
    if (cache !== undefined) tokenCache.deserialize(cache);
    const result = await client.acquireTokenByCode({
      code,
      codeVerifier,
      scopes: [...SCOPES],
      redirectUri: config.redirectUri,
    });
    return normalizeResult(result, config, tokenCache);
  } catch (e) {
    throw redact(e, "oauth_exchange_failed");
  }
}
export async function refreshTokenFromCache({
  cache,
  accountId,
  env = process.env,
  msalFactory,
  fetcher = fetch,
} = {}) {
  if (!enabled(env, "refresh")) return { enabled: false };
  const config = readM365OAuthConfig(env);
  validCache(cache);
  opaque(accountId, 1, 1024, /^[^\s\x00]+$/);
  try {
    const client = await clientFor(config, env, msalFactory, fetcher),
      tokenCache = client.getTokenCache();
    tokenCache.deserialize(cache);
    const account = await tokenCache.getAccountByHomeId(accountId);
    if (!account) throw m365OAuthError("oauth_reauth_required");
    const result = await client.acquireTokenSilent({
      account,
      scopes: [...SCOPES],
    });
    return normalizeResult(result, config, tokenCache, accountId);
  } catch (e) {
    throw redact(e, "oauth_refresh_failed");
  }
}
