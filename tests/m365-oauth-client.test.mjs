import test from "node:test";
import assert from "node:assert/strict";
import {
  readM365OAuthConfig,
  getAuthUrl,
  exchangeCode,
  refreshTokenFromCache,
  encryptM365Cache,
  decryptM365Cache,
} from "../lib/m365-oauth-client.mjs";
const env = {
  M365_AUTH_MODE: "delegated",
  M365_CONNECT_ENABLED: "true",
  M365_INGEST_ENABLED: "true",
  M365_MAILBOX: "veryvera@nadbytecna.cz",
  M365_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  M365_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  M365_CLIENT_SECRET: "synthetic-client-secret",
  M365_OAUTH_REDIRECT_URI:
    "https://nadbytecna.cz/api/mail-connect/?step=callback",
  M365_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const cache = JSON.stringify({
  Account: { synthetic: {} },
  RefreshToken: { synthetic: { secret: "synthetic-refresh" } },
});
const result = {
  account: { homeAccountId: "synthetic-account" },
  tenantId: env.M365_TENANT_ID,
  accessToken: "synthetic-access",
  scopes: ["User.Read", "Mail.Read", "openid", "profile", "offline_access"],
};
function mock(overrides = {}) {
  const calls = [],
    tokenCache = {
      serialize: () => cache,
      deserialize: (value) => calls.push(["deserialize", value]),
      getAccountByHomeId: async (id) => ({ homeAccountId: id }),
    };
  const client = {
    getTokenCache: () => tokenCache,
    getAuthCodeUrl: async (p) => {
      calls.push(["url", p]);
      return (
        "https://login.microsoftonline.com/" +
        env.M365_TENANT_ID +
        "/oauth2/v2.0/authorize?state=" +
        p.state
      );
    },
    acquireTokenByCode: async (p) => {
      calls.push(["code", p]);
      return result;
    },
    acquireTokenSilent: async (p) => {
      calls.push(["silent", p]);
      return result;
    },
    ...overrides,
  };
  return {
    calls,
    client,
    tokenCache,
    msalFactory: async (config) => {
      calls.push(["factory", config]);
      return client;
    },
  };
}
test("delegated OAuth flags off bypass all config, factories and networks", async () => {
  let calls = 0;
  const options = {
    env: {},
    msalFactory: () => {
      calls++;
    },
    fetcher: () => {
      calls++;
    },
  };
  assert.deepEqual(await getAuthUrl(options), { enabled: false });
  assert.deepEqual(await exchangeCode(options), { enabled: false });
  assert.deepEqual(await refreshTokenFromCache(options), { enabled: false });
  assert.equal(calls, 0);
});
test("delegated OAuth config has exact mailbox, canonical callback, fixed tenant and no secret output", () => {
  const c = readM365OAuthConfig(env);
  assert.equal(c.redirectUri, env.M365_OAUTH_REDIRECT_URI);
  assert.deepEqual(c.scopes, ["User.Read", "Mail.Read"]);
  assert.ok(!JSON.stringify(c).includes(env.M365_CLIENT_SECRET));
  for (const patch of [
    { M365_TENANT_ID: "common" },
    { M365_CLIENT_ID: "bad" },
    {
      M365_OAUTH_REDIRECT_URI:
        "https://evil.invalid/api/mail-connect/?step=callback",
    },
    {
      M365_OAUTH_REDIRECT_URI:
        "https://nadbytecna.cz/api/mail-connect/?step=callback#fragment",
    },
    { M365_TOKEN_ENCRYPTION_KEY: "not-a-key" },
    { M365_MAILBOX: "other@example.invalid" },
  ])
    assert.throws(
      () => readM365OAuthConfig({ ...env, ...patch }),
      (e) => e.code === "oauth_configuration",
    );
});
test("explicitly enabled Vercel preview uses its exact configured callback and origin", async () => {
  const preview = {
    ...env,
    VERCEL_ENV: "preview",
    M365_OAUTH_ALLOW_PREVIEW: "true",
    M365_OAUTH_REDIRECT_URI:
      "https://nadbytecna-staging-abc123.vercel.app/api/mail-connect/?step=callback",
  };
  const config = readM365OAuthConfig(preview);
  assert.equal(config.redirectUri, preview.M365_OAUTH_REDIRECT_URI);
  assert.equal(config.publicOrigin, "https://nadbytecna-staging-abc123.vercel.app");
  const m = mock();
  await getAuthUrl({
    env: preview,
    state: "s".repeat(43),
    codeChallenge: "c".repeat(43),
    msalFactory: m.msalFactory,
  });
  assert.equal(m.calls.find(([kind]) => kind === "url")[1].redirectUri, config.redirectUri);
});
test("preview callback requires both the preview deployment and explicit permission", () => {
  for (const patch of [
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "preview", M365_OAUTH_ALLOW_PREVIEW: "false" },
    { VERCEL_ENV: "production", M365_OAUTH_ALLOW_PREVIEW: "true" },
    { M365_OAUTH_ALLOW_PREVIEW: "true" },
  ])
    assert.throws(
      () => readM365OAuthConfig({
        ...env,
        ...patch,
        M365_OAUTH_REDIRECT_URI: "https://staging.vercel.app/api/mail-connect/?step=callback",
      }),
      (e) => e.code === "oauth_configuration",
    );
  assert.equal(readM365OAuthConfig({ ...env, VERCEL_ENV: "production" }).redirectUri, env.M365_OAUTH_REDIRECT_URI);
});
test("preview callback rejects hostile authorities and any altered callback path or query", () => {
  for (const uri of [
    "https://user@staging.vercel.app/api/mail-connect/?step=callback",
    "https://staging.vercel.app:443/api/mail-connect/?step=callback",
    "https://staging.vercel.app:8443/api/mail-connect/?step=callback",
    "https://staging.vercel.app.evil.invalid/api/mail-connect/?step=callback",
    "https://vercel.app/api/mail-connect/?step=callback",
    "http://staging.vercel.app/api/mail-connect/?step=callback",
    "https://staging.vercel.app/api/mail-connect/?step=callback#fragment",
    "https://staging.vercel.app/api/mail-connect/?step=callback&extra=1",
    "https://staging.vercel.app/api/mail-connect/?step=callback&step=callback",
    "https://staging.vercel.app/api/mail-connect?step=callback",
    "https://staging.vercel.app/api/mail-connect/?step=%63allback",
  ])
    assert.throws(
      () => readM365OAuthConfig({
        ...env,
        VERCEL_ENV: "preview",
        M365_OAUTH_ALLOW_PREVIEW: "true",
        M365_OAUTH_REDIRECT_URI: uri,
      }),
      (e) => e.code === "oauth_configuration",
    );
});
test("auth URL request uses server-side confidential client, PKCE S256, opaque state and only read scopes", async () => {
  const m = mock(),
    state = "s".repeat(43),
    challenge = "c".repeat(43);
  const r = await getAuthUrl({
    env,
    state,
    codeChallenge: challenge,
    msalFactory: m.msalFactory,
  });
  assert.equal(r.enabled, true);
  const config = m.calls[0][1],
    request = m.calls[1][1];
  assert.equal(config.auth.clientSecret, env.M365_CLIENT_SECRET);
  assert.equal(config.system.loggerOptions.piiLoggingEnabled, false);
  assert.equal(request.codeChallengeMethod, "S256");
  assert.equal(request.state, state);
  assert.equal(request.codeChallenge, challenge);
  assert.equal(request.loginHint, env.M365_MAILBOX);
  assert.equal(request.responseMode, "query");
  assert.deepEqual(request.scopes, ["User.Read", "Mail.Read"]);
});
test("code exchange returns serialized cache only to server and rejects tenant mismatch", async () => {
  const m = mock(),
    r = await exchangeCode({
      env,
      code: "synthetic-code",
      codeVerifier: "v".repeat(43),
      cache,
      msalFactory: m.msalFactory,
    });
  assert.equal(r.cache, cache);
  assert.equal(r.accountId, "synthetic-account");
  assert.equal(r.tenantId, env.M365_TENANT_ID);
  assert.equal(r.accessToken, "synthetic-access");
  const req = m.calls.find((c) => c[0] === "code")[1];
  assert.equal(req.codeVerifier, "v".repeat(43));
  assert.equal(req.redirectUri, env.M365_OAUTH_REDIRECT_URI);
  await assert.rejects(
    () =>
      exchangeCode({
        env,
        code: "synthetic-code",
        codeVerifier: "v".repeat(43),
        msalFactory: mock({
          acquireTokenByCode: async () => ({
            ...result,
            tenantId: "33333333-3333-4333-8333-333333333333",
          }),
        }).msalFactory,
      }),
    (e) => e.code === "oauth_identity_invalid",
  );
});
test("silent refresh uses exact cached account and can work while new invitations disabled", async () => {
  const m = mock();
  const r = await refreshTokenFromCache({
    env: { ...env, M365_CONNECT_ENABLED: "false" },
    cache,
    accountId: "synthetic-account",
    msalFactory: m.msalFactory,
  });
  assert.equal(r.enabled, true);
  assert.equal(
    m.calls.find((c) => c[0] === "silent")[1].account.homeAccountId,
    "synthetic-account",
  );
  const missing = mock();
  missing.tokenCache.getAccountByHomeId = async () => null;
  await assert.rejects(
    () =>
      refreshTokenFromCache({
        env,
        cache,
        accountId: "missing",
        msalFactory: missing.msalFactory,
      }),
    (e) => e.code === "oauth_reauth_required",
  );
});
test("AES-GCM has fresh IV, authenticated context and no plaintext leakage", () => {
  const context = "token-cache",
    a = encryptM365Cache({ cache, env, context }),
    b = encryptM365Cache({ cache, env, context });
  assert.notEqual(a, b);
  assert.ok(!a.includes("synthetic-refresh"));
  assert.equal(decryptM365Cache({ encrypted: a, env, context }), cache);
  for (const options of [
    { context: "other" },
    {
      env: {
        ...env,
        M365_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
      },
    },
    { encrypted: a.slice(0, -1) + (a.endsWith("A") ? "B" : "A") },
  ])
    assert.throws(
      () => decryptM365Cache({ encrypted: a, env, context, ...options }),
      (e) =>
        ["oauth_cache_decryption_failed", "oauth_cache_invalid"].includes(
          e.code,
        ),
    );
  assert.equal(
    decryptM365Cache({
      encrypted: encryptM365Cache({
        cache: "v".repeat(43),
        env,
        context: "pkce",
      }),
      env,
      context: "pkce",
    }),
    "v".repeat(43),
  );
});
test("OAuth validation and errors never expose code, cache, client secret or tokens", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      exchangeCode({
        env,
        code: "synthetic-code",
        codeVerifier: "short",
        msalFactory: () => {
          calls++;
        },
      }),
    (e) => e.code === "oauth_request_invalid",
  );
  assert.equal(calls, 0);
  const secret = "synthetic-client-secret synthetic-code synthetic-access";
  await assert.rejects(
    () =>
      exchangeCode({
        env,
        code: "synthetic-code",
        codeVerifier: "v".repeat(43),
        msalFactory: mock({
          acquireTokenByCode: async () => {
            throw new Error(secret);
          },
        }).msalFactory,
      }),
    (e) =>
      e.code === "oauth_exchange_failed" && !String(e.stack).includes(secret),
  );
  await assert.rejects(
    () =>
      refreshTokenFromCache({
        env,
        cache,
        accountId: "synthetic-account",
        msalFactory: mock({
          acquireTokenSilent: async () => {
            throw { errorCode: "interaction_required", message: secret };
          },
        }).msalFactory,
      }),
    (e) =>
      e.code === "oauth_reauth_required" && !String(e.stack).includes(secret),
  );
});
test("client credential rejection uses only fixed MSAL machine codes and drops all server details", async () => {
  const privateText = "synthetic-secret-code-token-private-description";
  for (const operation of ["exchange", "refresh"]) {
    for (const reason of [
      { errorCode: "invalid_client" },
      { errorCode: "invalid_client_credential" },
      { errorCode: "invalid_grant", errorNo: 7000215 },
      { errorCode: "server_error", errorNo: 7000222 },
      { errorCode: "server_error", errorNo: "7000215" },
      { errorCode: "server_error", errorNo: "7000222" },
    ]) {
      const fail = async () => {
        throw { ...reason, message: privateText, errorMessage: privateText, correlationId: privateText };
      };
      const msalFactory = mock({ acquireTokenByCode: fail, acquireTokenSilent: fail }).msalFactory;
      await assert.rejects(
        () => operation === "exchange"
          ? exchangeCode({ env, code: "synthetic-code", codeVerifier: "v".repeat(43), msalFactory })
          : refreshTokenFromCache({ env, cache, accountId: "synthetic-account", msalFactory }),
        (error) => {
          assert.equal(error.code, "oauth_client_rejected");
          assert.equal(error.name, "M365OAuthError");
          assert.ok(!String(error.stack).includes(privateText));
          assert.ok(!JSON.stringify(error).includes(privateText));
          assert.equal(error.cause, undefined);
          return true;
        },
      );
    }
  }
  // Free text and unrelated machine codes must not be interpreted as credential rejection.
  for (const reason of [
    { errorCode: "server_error", errorNo: 7000223 },
    { errorCode: "server_error", message: "AADSTS7000215 invalid_client" },
  ]) {
    await assert.rejects(
      () => exchangeCode({ env, code: "synthetic-code", codeVerifier: "v".repeat(43), msalFactory: mock({ acquireTokenByCode: async () => { throw reason; } }).msalFactory }),
      (error) => error.code === "oauth_exchange_failed",
    );
  }
});
test("MSAL supported transport blocks other hosts and redirects, bounds responses and uses timeout", async () => {
  const m = mock();
  let count = 0;
  await getAuthUrl({
    env,
    state: "s".repeat(43),
    codeChallenge: "c".repeat(43),
    msalFactory: m.msalFactory,
    fetcher: async (url, opt) => {
      count++;
      assert.equal(new URL(url).hostname, "login.microsoftonline.com");
      assert.equal(opt.redirect, "error");
      assert.ok(opt.signal);
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const network = m.calls[0][1].system.networkClient;
  await assert.rejects(
    () => network.sendGetRequestAsync("https://evil.invalid/"),
    (e) => e.code === "oauth_network_blocked",
  );
  assert.equal(count, 0);
  const r = await network.sendPostRequestAsync(
    "https://login.microsoftonline.com/" +
      env.M365_TENANT_ID +
      "/oauth2/v2.0/token",
    { body: "synthetic" },
  );
  assert.equal(r.status, 200);
  assert.equal(count, 1);
});

test("OAuth requires both delegated Graph read scopes and accepts canonical resource-prefixed case variants", async () => {
  for (const scopes of [
    [],
    ["User.Read"],
    ["Mail.Read"],
    ["Mail.ReadWrite", "User.Read"],
  ])
    await assert.rejects(
      () =>
        exchangeCode({
          env,
          code: "synthetic-code",
          codeVerifier: "v".repeat(43),
          msalFactory: mock({
            acquireTokenByCode: async () => ({ ...result, scopes }),
          }).msalFactory,
        }),
      (e) => e.code === "oauth_scope_missing",
    );
  const r = await exchangeCode({
    env,
    code: "synthetic-code",
    codeVerifier: "v".repeat(43),
    msalFactory: mock({
      acquireTokenByCode: async () => ({
        ...result,
        scopes: [
          "https://graph.microsoft.com/user.read",
          "HTTPS://GRAPH.MICROSOFT.COM/MAIL.READ",
        ],
      }),
    }).msalFactory,
  });
  assert.equal(r.enabled, true);
});

test("installed MSAL builds a PKCE URL and includes offline_access using mocked Microsoft discovery only", async () => {
  const seen = [];
  const r = await getAuthUrl({
    env,
    state: "s".repeat(43),
    codeChallenge: "c".repeat(43),
    fetcher: async (url, opt) => {
      seen.push(url);
      const u = new URL(url);
      assert.equal(u.host, "login.microsoftonline.com");
      assert.equal(opt.method, "GET");
      let body;
      if (u.pathname === "/common/discovery/instance")
        body = {
          tenant_discovery_endpoint:
            "https://login.microsoftonline.com/" +
            env.M365_TENANT_ID +
            "/v2.0/.well-known/openid-configuration",
          metadata: [
            {
              preferred_network: "login.microsoftonline.com",
              preferred_cache: "login.microsoftonline.com",
              aliases: ["login.microsoftonline.com"],
            },
          ],
        };
      else if (u.pathname.endsWith("/.well-known/openid-configuration")) {
        const a = "https://login.microsoftonline.com/" + env.M365_TENANT_ID;
        body = {
          authorization_endpoint: a + "/oauth2/v2.0/authorize",
          token_endpoint: a + "/oauth2/v2.0/token",
          end_session_endpoint: a + "/oauth2/v2.0/logout",
          issuer: a + "/v2.0",
          jwks_uri: a + "/discovery/v2.0/keys",
        };
      } else throw new Error("Unexpected mocked discovery path");
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const u = new URL(r.url);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("redirect_uri"), env.M365_OAUTH_REDIRECT_URI);
  const scopes = u.searchParams.get("scope").split(" ");
  for (const s of ["User.Read", "Mail.Read", "offline_access"])
    assert.ok(scopes.includes(s));
  assert.ok(!r.url.includes(env.M365_CLIENT_SECRET));
});
