import crypto from "node:crypto";
import { rpc, fail } from "./admin-server.mjs";
import { MAILBOX } from "./mail-service.mjs";
import { readM365Config } from "./m365-readonly.mjs";
import {
  readM365OAuthConfig,
  encryptM365Cache,
  decryptM365Cache,
  refreshTokenFromCache,
} from "./m365-oauth-client.mjs";

export const oauthRpc = (action, payload = {}) =>
  rpc("mail_oauth", { p_action: action, p_payload: payload });
export const oauthHash = (s) =>
  crypto.createHash("sha256").update(s).digest("hex");
export const delegatedMode = (env = process.env) =>
  env.M365_AUTH_MODE === "delegated";
export function oauthReadiness(env = process.env) {
  let configured = false;
  if (delegatedMode(env))
    try {
      readM365OAuthConfig(env);
      configured = true;
    } catch {}
  return {
    authMode: delegatedMode(env) ? "delegated" : "certificate",
    connectConfigured: configured,
    connectInviteEnabled: configured && env.M365_CONNECT_ENABLED === "true",
  };
}
export async function issueMailInvitation(user) {
  if (!oauthReadiness().connectInviteEnabled)
    throw fail(423, "mail_connect_not_configured");
  const c = readM365OAuthConfig(process.env),
    token = crypto.randomBytes(32).toString("base64url");
  const d = await oauthRpc("issue", {
    token_hash: oauthHash(token),
    tenant_id: c.tenantId,
    actor_id: user.id,
    actor_email: user.email,
  });
  // Fragment is never sent to HTTP access logs or Referer headers; public JS removes it immediately.
  return {
    url: new URL("/api/mail-connect/", c.redirectUri).href + "#invite=" + token,
    expiresAt: d.expires_at,
  };
}
export async function disconnectMail(user) {
  await oauthRpc("disconnect", { actor_id: user.id, actor_email: user.email });
  return { ok: true };
}
export async function getDelegatedMailToken({
  env = process.env,
  refresh = refreshTokenFromCache,
  store = oauthRpc,
} = {}) {
  if (!delegatedMode(env) || env.M365_INGEST_ENABLED !== "true")
    return { enabled: false, accessToken: null };
  const c = readM365OAuthConfig(env);
  readM365Config(env);
  const saved = await store("cache_get");
  if (!saved || saved.mailbox !== MAILBOX || saved.tenant_id !== c.tenantId)
    throw fail(503, "mail_reconnect_required");
  const cache = decryptM365Cache({
    encrypted: saved.ciphertext,
    env,
    context: "oauth-cache",
  });
  const out = await refresh({ cache, accountId: saved.account_id, env });
  if (
    !out.enabled ||
    out.accountId !== saved.account_id ||
    out.tenantId !== c.tenantId ||
    !out.accessToken
  )
    throw fail(503, "mail_reconnect_required");
  const changed = await store("cache_set", {
    ciphertext: encryptM365Cache({
      cache: out.cache,
      env,
      context: "oauth-cache",
    }),
    expected_version: saved.version,
    expected_generation: saved.generation,
  });
  if (!changed.saved) throw fail(503, "mail_connection_changed");
  return { enabled: true, accessToken: out.accessToken, generation: saved.generation };
}
