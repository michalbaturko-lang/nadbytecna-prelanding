import test from "node:test";
import assert from "node:assert/strict";
import { exchangeCode, refreshTokenFromCache } from "../lib/m365-oauth-client.mjs";

// Exercise the installed MSAL package, never an MSAL factory double or a real identity.
const env = {
  M365_AUTH_MODE: "delegated",
  M365_CONNECT_ENABLED: "true",
  M365_INGEST_ENABLED: "true",
  M365_MAILBOX: "veryvera@nadbytecna.cz",
  M365_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  M365_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  M365_CLIENT_SECRET: "synthetic-secret-only",
  M365_OAUTH_REDIRECT_URI: "https://nadbytecna.cz/api/mail-connect/?step=callback",
  M365_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
};
const uid = "33333333-3333-4333-8333-333333333333";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function tokenResponse() {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: env.M365_CLIENT_ID, iss: `https://login.microsoftonline.com/${env.M365_TENANT_ID}/v2.0`,
    tid: env.M365_TENANT_ID, oid: uid, sub: "synthetic-subject",
    preferred_username: "synthetic@example.invalid", name: "Synthetic identity",
    iat: now, nbf: now, exp: now + 3600,
  };
  return {
    token_type: "Bearer", scope: "Mail.Read User.Read openid profile",
    expires_in: 3600, ext_expires_in: 3600,
    access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
    id_token: `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.synthetic-signature`,
    client_info: b64({ uid, utid: env.M365_TENANT_ID }),
  };
}
function transport({ token = tokenResponse(), status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      const u = new URL(url);
      assert.equal(u.origin, "https://login.microsoftonline.com");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal);
      calls.push({ path: u.pathname, method: options.method });
      const authority = `https://login.microsoftonline.com/${env.M365_TENANT_ID}`;
      let body, responseStatus = 200;
      if (u.pathname === "/common/discovery/instance") {
        assert.equal(options.method, "GET");
        body = {
          tenant_discovery_endpoint: `${authority}/v2.0/.well-known/openid-configuration`,
          metadata: [{ preferred_network: u.hostname, preferred_cache: u.hostname, aliases: [u.hostname] }],
        };
      } else if (u.pathname.endsWith("/.well-known/openid-configuration")) {
        assert.equal(options.method, "GET");
        body = {
          authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token`,
          end_session_endpoint: `${authority}/oauth2/v2.0/logout`, issuer: `${authority}/v2.0`,
          jwks_uri: `${authority}/discovery/v2.0/keys`,
        };
      } else if (u.pathname === `/${env.M365_TENANT_ID}/oauth2/v2.0/token`) {
        assert.equal(options.method, "POST");
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("client_id"), env.M365_CLIENT_ID);
        assert.equal(form.get("client_secret"), env.M365_CLIENT_SECRET);
        if (form.get("grant_type") === "authorization_code") {
          assert.equal(form.get("code"), "synthetic-code");
          assert.equal(form.get("code_verifier"), "v".repeat(43));
          assert.equal(form.get("redirect_uri"), env.M365_OAUTH_REDIRECT_URI);
        } else {
          assert.equal(form.get("grant_type"), "refresh_token");
          assert.equal(form.get("refresh_token"), "synthetic-refresh-token");
          assert.equal(form.has("code"), false);
          assert.equal(form.has("code_verifier"), false);
        }
        for (const scope of ["Mail.Read", "User.Read", "offline_access"]) assert.ok(form.get("scope").split(" ").includes(scope));
        body = token;
        responseStatus = status;
      } else throw new Error("Unexpected synthetic Microsoft endpoint");
      return new Response(JSON.stringify(body), { status: responseStatus, headers: { "content-type": "application/json" } });
    },
  };
}
test("real MSAL exchanges a synthetic authorization code and round-trips its serialized cache", async () => {
  const network = transport();
  const result = await exchangeCode({ env, code: "synthetic-code", codeVerifier: "v".repeat(43), fetcher: network.fetcher });
  assert.equal(result.enabled, true);
  assert.equal(result.accessToken, "synthetic-access-token");
  assert.equal(result.tenantId, env.M365_TENANT_ID);
  assert.equal(result.accountId, `${uid}.${env.M365_TENANT_ID}`);
  const stored = JSON.parse(result.cache);
  assert.ok(Object.keys(stored.Account).length);
  assert.ok(Object.keys(stored.RefreshToken).length);
  assert.equal(network.calls.filter((call) => call.method === "POST").length, 1);
  const refreshed = await refreshTokenFromCache({
    env, cache: result.cache, accountId: result.accountId,
    fetcher: network.fetcher,
  });
  assert.equal(refreshed.accountId, result.accountId);
  assert.equal(refreshed.tenantId, result.tenantId);
  assert.equal(refreshed.accessToken, result.accessToken);
  // A new SDK client may rediscover authority metadata, but reuses the fresh token.
  assert.equal(network.calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(Object.keys(JSON.parse(refreshed.cache).RefreshToken).length);
});

test("real MSAL refreshes an expired cached access token using only its cached refresh token", async () => {
  const network = transport();
  const result = await exchangeCode({ env, code: "synthetic-code", codeVerifier: "v".repeat(43), fetcher: network.fetcher });
  const stored = JSON.parse(result.cache);
  for (const token of Object.values(stored.AccessToken)) {
    token.expires_on = "1";
    token.ext_expires_on = "1";
  }
  const refreshed = await refreshTokenFromCache({ env, cache: JSON.stringify(stored), accountId: result.accountId, fetcher: network.fetcher });
  assert.equal(refreshed.accountId, result.accountId);
  assert.equal(refreshed.accessToken, result.accessToken);
  assert.equal(network.calls.filter((call) => call.method === "POST").length, 2);
});

test("real MSAL server credential rejection becomes a fixed safe diagnostic", async () => {
  for (const errorNo of [7000215, 7000222]) {
    const privateText = "synthetic-secret-code-token-correlation-details";
    const network = transport({ status: 401, token: {
      error: "invalid_client", error_description: privateText, error_codes: [errorNo],
      correlation_id: privateText, trace_id: privateText,
    } });
    await assert.rejects(
      () => exchangeCode({ env, code: "synthetic-code", codeVerifier: "v".repeat(43), fetcher: network.fetcher }),
      (error) => {
        assert.equal(error.code, "oauth_client_rejected");
        assert.ok(!String(error.stack).includes(privateText));
        assert.ok(!JSON.stringify(error).includes(privateText));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(network.calls.filter((call) => call.method === "POST").length, 1);
  }
});
